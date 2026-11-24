import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { assertBundledPluginsCurrent } from '../../bundled-plugins/assertBundledPluginsCurrent.mjs';
import { launchInstalledDesktop, until } from '../windows/installedDesktopSession.mjs';
import { readInstalledApp } from './installedApp.mjs';

/**
 * 正式候选包上的真实旧版升级：把已发布旧版留下的 profile 与 Workspace 复制进隔离目录，
 * 用已安装的候选 App 启动。源码 Host 上的同一场景见 ../legacy-upgrade.acceptance.mjs。
 * 基线必须来自同一平台；Windows 在验收虚拟机的普通用户桌面会话里执行。
 *
 *   node scripts/e2e/knowledge-plugin/legacy-upgrade/installed-upgrade.acceptance.mjs \
 *     --app <候选 Linnya.app 或安装目录里的 林芽.exe> --expect-version <x.y.z> --baseline <基线目录> --out <新目录>
 *
 * 检查：候选能正常启动且版本正确；每个随包插件换到安装包里的版本、内容一致并启用；
 * 旧知识库仍在（id 与名称不变）；只有空库时不自动下载知识库；正常退出。
 * 从正式 catalog 安装知识库依赖 catalog 重签后的内容，不在这里覆盖。
 */
const { values } = parseArgs({ options: {
  app: { type: 'string' }, 'expect-version': { type: 'string' }, baseline: { type: 'string' }, out: { type: 'string' },
} });
for (const name of ['app', 'expect-version', 'baseline', 'out']) assert.ok(values[name], `缺少 --${name}`);
const baselineRoot = path.resolve(values.baseline);
const out = path.resolve(values.out);
assert.equal(existsSync(out), false, `--out 必须是新目录：${out}`);

const baseline = JSON.parse(readFileSync(path.join(baselineRoot, 'baseline.json'), 'utf8'));
assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.platform, `${process.platform}-${process.arch}`, 'baseline must come from this platform');
const app = path.resolve(values.app);
const { executable, version: installedVersion, bundledPluginRoot } = readInstalledApp(app);
assert.equal(installedVersion, values['expect-version'], '候选版本');

const session = path.join(out, 'session');
const evidence = path.join(out, 'evidence');
cpSync(path.join(baselineRoot, 'session'), session, { recursive: true });
rmSync(path.join(session, 'profile', 'DevToolsActivePort'), { force: true });
const writeEvidence = (name, value) => {
  mkdirSync(evidence, { recursive: true });
  writeFileSync(path.join(evidence, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};

function findWorkspaceDatabase() {
  const queue = [path.join(session, 'workspace')];
  while (queue.length) {
    const directory = queue.shift();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === 'workspace.sqlite') return file;
      if (entry.isDirectory()) queue.push(file);
    }
  }
  throw new Error('找不到 workspace.sqlite');
}

function readState() {
  const db = new DatabaseSync(findWorkspaceDatabase(), { readOnly: true });
  try {
    // node:sqlite 返回无原型对象，转成普通对象再比较与写证据。
    const row = value => (value ? { ...value } : null);
    return {
      knowledgeBase: row(db.prepare('SELECT id, name FROM knowledge_bases WHERE id = ?').get(baseline.knowledgeBase.id)),
      knowledgeInstall: row(db.prepare("SELECT installed, user_removed FROM installed_plugins WHERE plugin_id='knowledge'").get()),
    };
  } finally { db.close(); }
}

const checks = [];
const check = async (name, body) => {
  try { await body(); checks.push({ name, status: 'passed' }); }
  catch (error) { checks.push({ name, status: 'failed', error: String(error?.stack ?? error) }); throw error; }
};

let application;
try {
  await check('候选在旧版资料上正常启动，版本正确', async () => {
    application = await launchInstalledDesktop(executable, session);
    const version = await application.evaluate('window.electronAPI.getVersion?.() ?? null');
    if (version !== null) assert.equal(version, values['expect-version']);
  });

  await check('随包插件：都换到安装包里的这一版（版本、内容一致且已启用），新增的随包插件也默认装上', async () => {
    const listing = await until(
      () => application.evaluate('window.electronAPI.plugins.list()'),
      value => value?.success === true && value.data.length > 0,
      'Plugin listing',
    );
    const rows = assertBundledPluginsCurrent({
      bundledPluginRoot, userPluginRoot: path.join(session, 'profile', 'plugins'), listing: listing.data,
    });
    writeEvidence('bundled-plugins-after-upgrade.json', rows);
  });

  await check('旧知识库仍在；只有空库时不自动下载知识库', async () => {
    const state = readState();
    writeEvidence('knowledge-after-upgrade.json', state);
    assert.deepEqual(state.knowledgeBase, { id: baseline.knowledgeBase.id, name: baseline.knowledgeBase.name });
    if (baseline.documents.length === 0) {
      assert.equal(state.knowledgeInstall?.installed ?? 0, 0, 'empty legacy libraries must not trigger a download');
      assert.equal(existsSync(path.join(session, 'profile', 'plugins', 'knowledge', 'active.json')), false);
    }
  });

  await check('正常退出', async () => {
    writeEvidence('desktop.log', application.log);
    await application.stop();
    assert.equal(application.child.exitCode, 0, 'candidate must exit normally');
    application = undefined;
  });
} finally {
  if (application) await application.stop().catch(() => {});
  writeEvidence('result.json', { app, version: values['expect-version'], baseline: baselineRoot, checks });
  if (application?.log) writeEvidence('desktop.log', application.log);
  process.stdout.write(`${JSON.stringify({ evidence, checks }, null, 2)}\n`);
}
