import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(repoRoot, 'dist', 'dev-plugin-catalog');

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath, entry.name))
    .sort();
}

/**
 * 在本机开发 catalog 上发布同一插件的更高补丁版本：带一条合成迁移（可令其失败），重算 SHA512SUMS，
 * 重新打包并用开发密钥重签 catalog（序号 +1）。只改 dist/dev-plugin-catalog 这一构建输出；
 * restore() 恢复原 catalog 并删除新包，服务下次启动也会整份重新生成。
 *
 * fault 模拟下载面故障：missing（服务器上没有新包）、digest-mismatch（同长度但内容被改）、truncated（少了尾部字节）。
 */
export function publishNewerDevPluginVersion({ pluginId, origin, rejectMigration = false, fault = null }) {
  assert.ok(['missing', 'digest-mismatch', 'truncated', null].includes(fault));
  const catalogPath = path.join(outDir, 'catalog', 'stable.json');
  const originalCatalog = readFileSync(catalogPath, 'utf8');
  const envelope = JSON.parse(originalCatalog);
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
  const entry = payload.plugins.find(item => item.id === pluginId);
  assert.ok(entry, `${pluginId} must be in the dev catalog`);
  const [major, minor, patch] = entry.version.split('.').map(Number);
  const newer = `${major}.${minor}.${patch + 1}`;

  const work = mkdtempSync(path.join(tmpdir(), `linnya-${pluginId}-newer-`));
  const staged = path.join(work, 'plugin');
  const zipName = `${pluginId}-${newer}.zip`;
  const builtZip = path.join(work, zipName);
  try {
    execFileSync('unzip', ['-q', path.join(outDir, pluginId, `${pluginId}-${entry.version}.zip`), '-d', staged]);
    const manifest = JSON.parse(readFileSync(path.join(staged, 'plugin.json'), 'utf8'));
    assert.equal(manifest.version, entry.version);
    assert.equal(manifest.entry.backend, './dist/backend/index.cjs');
    const nextMigration = Math.max(...manifest.migrations.map(item => item.version)) + 1;
    const backend = './dist/backend/upgrade-acceptance.cjs';
    writeFileSync(path.join(staged, backend), `
const original = require('./index.cjs').default;
exports.backendPlugin = {
  ...original,
  meta: { ...original.meta, version: ${JSON.stringify(newer)} },
  pluginMigrations: [...original.pluginMigrations, {
    version: ${nextMigration},
    description: 'Synthetic upgrade acceptance migration',
    up(db) {
      db.exec('ALTER TABLE knowledge_bases ADD COLUMN upgrade_acceptance INTEGER NOT NULL DEFAULT 1');
      ${rejectMigration ? "throw new Error('Upgrade acceptance deliberately rejected migration');" : ''}
    }
  }],
};
`, { flag: 'wx' });
    writeFileSync(path.join(staged, 'plugin.json'), `${JSON.stringify({
      ...manifest,
      version: newer,
      entry: { ...manifest.entry, backend },
      migrations: [...manifest.migrations, { version: nextMigration, description: 'Synthetic upgrade acceptance migration' }],
    }, null, 2)}\n`);
    const checksums = listFiles(staged)
      .filter(file => path.basename(file) !== 'SHA512SUMS')
      .map(file => `${createHash('sha512').update(readFileSync(file)).digest('hex')}  ${path.relative(staged, file).split(path.sep).join('/')}`)
      .join('\n');
    writeFileSync(path.join(staged, 'SHA512SUMS'), `${checksums}\n`);
    const unpackedSize = listFiles(staged).reduce((total, file) => total + statSync(file).size, 0);
    execFileSync('zip', ['-q', '-X', '-r', builtZip, '.'], { cwd: staged });
    const bytes = readFileSync(builtZip);
    const published = path.join(outDir, pluginId, zipName);

    const nextPayload = {
      ...payload,
      sequence: payload.sequence + 1,
      issuedAt: new Date(Math.max(Date.now(), Date.parse(payload.issuedAt) + 1000)).toISOString().replace(/\.\d{3}Z$/u, '.000Z'),
      plugins: payload.plugins.map(item => item.id !== pluginId ? item : {
        ...item, version: newer, artifactUrl: `${origin}/${pluginId}/${zipName}`,
        sha512: createHash('sha512').update(bytes).digest('hex'), size: bytes.length, unpackedSize,
      }),
    };
    const payloadBytes = Buffer.from(JSON.stringify(nextPayload), 'utf8');
    const privateKey = createPrivateKey(readFileSync(path.join(outDir, 'dev-signing-key.pem'), 'utf8'));
    writeFileSync(catalogPath, JSON.stringify({
      ...envelope, payload: payloadBytes.toString('base64'), signature: sign(null, payloadBytes, privateKey).toString('base64'),
    }));

    const placeArtifact = () => copyFileSync(builtZip, published);
    if (fault === null) placeArtifact();
    else if (fault === 'digest-mismatch') {
      const damaged = Buffer.from(bytes);
      damaged[Math.floor(damaged.length / 2)] ^= 0xff;
      writeFileSync(published, damaged);
    } else if (fault === 'truncated') {
      placeArtifact();
      truncateSync(published, bytes.length - 1024);
    }
    const keep = path.join(work, 'keep');
    copyFileSync(builtZip, `${keep}.zip`);
    return {
      version: newer,
      migrationVersion: nextMigration,
      /** 修好服务器上的新包（故障场景的“发布方修复后重试”）。 */
      repairArtifact() { copyFileSync(`${keep}.zip`, published); },
      restore() {
        writeFileSync(catalogPath, originalCatalog);
        rmSync(published, { force: true });
        rmSync(work, { recursive: true, force: true });
      },
    };
  } catch (error) {
    writeFileSync(catalogPath, originalCatalog);
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

