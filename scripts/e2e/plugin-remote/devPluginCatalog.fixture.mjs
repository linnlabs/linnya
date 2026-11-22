import { spawn } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KEY_ID = 'linnya-plugins-dev-local';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * 在本机回环地址启动开发插件 catalog（serve-dev-plugin-catalog.mjs），并把 Desktop 需要的
 * LINNYA_DEV_PLUGIN_CATALOG_* 写入当前进程环境：之后由本进程启动的探针实例都使用它。
 * 只给源码运行的 Desktop 用；打包产物忽略这些变量。进程退出时关闭服务。
 */
export async function startDevPluginCatalog({ plugin, throttleKbps = 0, timeoutMs = 240_000 } = {}) {
  const port = await freePort();
  const args = ['--import', 'tsx', 'scripts/e2e/plugin-remote/serve-dev-plugin-catalog.mjs', '--plugin', plugin, '--port', String(port)];
  if (throttleKbps > 0) args.push('--throttle-kbps', String(throttleKbps));
  const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  const stop = () => { if (child.exitCode === null) child.kill('SIGTERM'); };
  // 服务进程不能撑住验收进程的事件循环：场景结束即退出，退出时顺带关闭服务。
  child.unref();
  process.once('exit', stop);
  const url = `http://127.0.0.1:${port}/catalog/stable.json`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`开发插件 catalog 服务提前退出: ${child.exitCode}`);
    const status = await fetch(url, { signal: AbortSignal.timeout(3_000) }).then(response => response.status, () => 0);
    if (status === 200) break;
    if (Date.now() > deadline) {
      stop();
      throw new Error('开发插件 catalog 服务未在时限内就绪');
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  const privateKey = createPrivateKey(readFileSync(path.join(repoRoot, 'dist', 'dev-plugin-catalog', 'dev-signing-key.pem'), 'utf8'));
  process.env.LINNYA_DEV_PLUGIN_CATALOG_URL = url;
  process.env.LINNYA_DEV_PLUGIN_CATALOG_KEY_ID = KEY_ID;
  process.env.LINNYA_DEV_PLUGIN_CATALOG_PUBLIC_KEY = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  return { url, port, stop };
}
