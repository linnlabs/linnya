import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 开发用插件 catalog 服务：用本机生成的测试密钥签名一份只含指定插件与所需运行时组件的 catalog，
 * 在 127.0.0.1 上提供下载，用于在源码运行的 Desktop 中端到端验证远程安装、进度/取消与运行时组件启动。
 *
 *   node --import tsx scripts/e2e/plugin-remote/serve-dev-plugin-catalog.mjs [--plugin knowledge] [--port 47123]
 *        [--throttle-kbps 512]
 *
 * 启动后打印 Desktop 需要的 LINNYA_DEV_PLUGIN_CATALOG_* 环境变量。测试密钥保存在输出目录，重启服务沿用同一把，
 * 已安装的回执在 Desktop 重启后仍能验签。只服务回环地址；打包产物会忽略这些变量。
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(repoRoot, 'dist', 'dev-plugin-catalog');
const KEY_ID = 'linnya-plugins-dev-local';

function readFlag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const pluginId = readFlag('plugin', 'knowledge');
const requestedPort = Number(readFlag('port', '0'));
const throttleKbps = Number(readFlag('throttle-kbps', '0'));

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败 (${result.status})`);
}

async function exists(file) {
  return fs.stat(file).then(() => true, () => false);
}

async function loadOrCreateSigningKey() {
  const keyPath = path.join(outDir, 'dev-signing-key.pem');
  if (await exists(keyPath)) return createPrivateKey(await fs.readFile(keyPath, 'utf8'));
  const { privateKey } = generateKeyPairSync('ed25519');
  await fs.writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return privateKey;
}

async function ensureRuntimeComponents(platformDir) {
  const metadataPath = path.join(platformDir, 'runtime.json');
  if (await exists(metadataPath)) {
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    if (Number.isInteger(metadata.unpackedSize)) return;
  }
  run(process.execPath, ['--import', 'tsx', 'scripts/release/package-runtime-component.mjs']);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'packages/plugins', pluginId, 'plugin.json'), 'utf8'));
  const zipName = `${pluginId}-${manifest.version}.zip`;
  const pluginZip = path.join(repoRoot, 'packages/plugins', pluginId, 'dist/artifacts', zipName);
  if (!(await exists(pluginZip))) run('pnpm', ['--dir', `packages/plugins/${pluginId}`, 'run', 'package:artifact']);

  const runtimeRoot = path.join(repoRoot, 'dist', 'runtime-components');
  if ((manifest.requiresRuntimes ?? []).some(item => item.id === 'qdrant')) {
    const require = createRequire(import.meta.url);
    const { readQdrantRuntimeCatalog, resolveQdrantRuntimeTarget } = require('../../build/qdrant-runtime/definitions/qdrant-runtime-catalog.cjs');
    const catalog = readQdrantRuntimeCatalog();
    const target = resolveQdrantRuntimeTarget(catalog, process.platform, process.arch);
    await ensureRuntimeComponents(path.join(runtimeRoot, 'qdrant', catalog.version, `${target.platform}-${target.architecture}`));
  }

  const server = http.createServer();
  await new Promise(resolve => server.listen(requestedPort, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  // 插件包与运行时组件按 catalog 地址布局复制到服务目录。
  await fs.mkdir(path.join(outDir, pluginId), { recursive: true });
  await fs.copyFile(pluginZip, path.join(outDir, pluginId, zipName));
  await fs.rm(path.join(outDir, 'runtimes'), { recursive: true, force: true });
  if (await exists(runtimeRoot)) await fs.cp(runtimeRoot, path.join(outDir, 'runtimes'), { recursive: true });

  const payloadPath = path.join(outDir, 'stable.payload.json');
  run(process.execPath, ['--import', 'tsx', 'scripts/release/generate-plugin-catalog.mjs', pluginId], {
    LINNYA_PLUGIN_CATALOG_OUTPUT: payloadPath,
    [`LINNYA_PLUGIN_${pluginId.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_DOWNLOAD_BASE_URL`]: `${origin}/${pluginId}`,
    LINNYA_PLUGIN_RUNTIME_DOWNLOAD_ROOT_URL: origin,
    // 秒级时间戳单调递增，重启服务后序号仍高于 Desktop 记住的高水位。
    LINNYA_PLUGIN_CATALOG_SEQUENCE: String(Math.floor(Date.now() / 1000)),
    LINNYA_PLUGIN_CATALOG_VALID_DAYS: '7',
  });
  const payloadBytes = Buffer.from(JSON.stringify(JSON.parse(await fs.readFile(payloadPath, 'utf8'))), 'utf8');
  const privateKey = await loadOrCreateSigningKey();
  await fs.mkdir(path.join(outDir, 'catalog'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'catalog', 'stable.json'), JSON.stringify({
    schemaVersion: 1,
    keyId: KEY_ID,
    payload: payloadBytes.toString('base64'),
    signature: sign(null, payloadBytes, privateKey).toString('base64'),
  }));

  server.on('request', async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url ?? '/', origin).pathname);
    const file = path.resolve(outDir, `.${requestPath}`);
    const relative = path.relative(outDir, file);
    const stats = await fs.stat(file).catch(() => null);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !stats?.isFile() || relative.endsWith('.pem')) {
      response.writeHead(404).end('not found');
      return;
    }
    console.log(`[dev-plugin-catalog] GET ${requestPath} (${stats.size} bytes)`);
    response.writeHead(200, { 'content-length': String(stats.size), 'content-type': 'application/octet-stream' });
    const stream = createReadStream(file, { highWaterMark: 64 * 1024 });
    if (throttleKbps <= 0 || requestPath.endsWith('.json')) {
      stream.pipe(response);
      return;
    }
    // 限速：每块之后按速率暂停，便于观察进度与中途取消。
    const delayMs = (64 * 1024) / (throttleKbps * 1024) * 1000;
    for await (const chunk of stream) {
      if (response.destroyed) break;
      response.write(chunk);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    response.end();
  });

  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  const digest = createHash('sha256').update(payloadBytes).digest('hex').slice(0, 12);
  console.log(`\n[dev-plugin-catalog] serving ${outDir} at ${origin} (catalog digest ${digest})`);
  console.log('Desktop 环境变量：');
  console.log(`  LINNYA_DEV_PLUGIN_CATALOG_URL=${origin}/catalog/stable.json`);
  console.log(`  LINNYA_DEV_PLUGIN_CATALOG_KEY_ID=${KEY_ID}`);
  console.log(`  LINNYA_DEV_PLUGIN_CATALOG_PUBLIC_KEY=${publicKey}`);
}

await main();
