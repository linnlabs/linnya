import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { clickNamed, installKnowledgeForScenario, knowledgeSidebar } from './knowledgeStore.fixture.mjs';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('plugin-parallel-lifecycle-ipc', { files: [
  'scripts/e2e/knowledge-plugin/parallel-lifecycle.acceptance.mjs',
  'scripts/e2e/knowledge-plugin/knowledgeStore.fixture.mjs',
] });
const test = acceptance(`plugin-parallel-lifecycle-${process.pid}`, { evidence });
const { run } = test;
const evaluate = async source => (await run('eval', source)).value;
const ids = ['slides', 'knowledge'];
const rowSql = `SELECT p.plugin_id,p.installed,p.user_removed,(e.plugin_id IS NOT NULL) enabled,a.status active
FROM installed_plugins p LEFT JOIN enabled_plugins e USING(plugin_id) LEFT JOIN plugin_active_versions a USING(plugin_id)
WHERE p.plugin_id IN ('knowledge','slides') ORDER BY p.plugin_id`;
let db;
let failure;
let desktopLog;

const compare = (id, installed, enabled) => {
  const row = db.prepare(rowSql).all().find(value => value.plugin_id === id);
  assert.ok(row, id);
  assert.equal(row.installed, Number(installed), id);
  assert.equal(row.user_removed, Number(!installed), id);
  assert.equal(row.enabled, Number(enabled), id);
  assert.equal(row.active, installed ? 'active' : null, id);
  return row;
};
const list = async () => {
  const listing = await evaluate('window.electronAPI.plugins.list()');
  assert.equal(listing.success, true);
  return Object.fromEntries(listing.data.filter(item => ids.includes(item.meta.id)).map(item => [item.meta.id, item.state]));
};
const shop = () => clickNamed(run, 'button', '插件', 'aside');

try {
  const up = await run('up', '--mode', 'bundled', '--size', '1440x1000');
  desktopLog = up.logs.desktop;
  await installKnowledgeForScenario(run);
  db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  await shop();
  await run('shot');
  await evidence.check('同一 profile 二次启动复用原主窗，不能产生第二个插件商店窗口', async () => {
    const { value } = await run('eval', '--main', `(async () => {
      const { app, BrowserWindow } = require('electron');
      const { execFile } = require('node:child_process');
      const { realpathSync } = require('node:fs');
      const path = require('node:path');
      const profile = app.getPath('userData');
      if (realpathSync(profile) !== realpathSync(path.join(${JSON.stringify(up.root)}, 'user-data'))) throw new Error('Not the isolated probe profile');
      const mainIds = () => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().startsWith(${JSON.stringify(up.viteUrl)})).map(window => window.id);
      const before = mainIds();
      const secondary = await new Promise((resolve, reject) => {
        execFile(process.execPath, [
          '-r', path.join(process.cwd(), 'scripts/development/features/desktop-probe/runtime/electronBootstrap.cjs'),
          '--user-data-dir=' + profile, path.join(process.cwd(), 'dist/main/main.cjs'),
        ], { timeout: 15000 }, error => error ? reject(error) : resolve('exited'));
      });
      return { before, after: mainIds(), secondary };
    })()`);
    assert.equal(value.secondary, 'exited');
    assert.equal(value.before.length, 1);
    assert.deepEqual(value.after, value.before);
    await run('wait', '--text', '已有插件');
    evidence.json('single-primary-window', value);
    await run('shot');
  });
  await evidence.check('两个插件走真实并发卸载请求，商店和运行注册表都移除', async () => {
    // 商店一次只能打开一个确认框；此处从真实 Preload 同时发送两个已确认请求。
    const result = await evaluate(`Promise.all(${JSON.stringify(ids)}.map(id=>window.electronAPI.plugins.uninstall(id)))`);
    assert.ok(result.every(value => value.success), JSON.stringify(result));
    await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
    assert.deepEqual(await list(), { knowledge: 'missing', slides: 'missing' });
    await run('click', 'text=插件市场');
    await run('wait', '--selector', '.plugin-store-card:has(button.plugin-store-install-button)');
    evidence.json('two-plugins-removed', { result, rows: ids.map(id => compare(id, false, false)) });
    await run('shot');
  });
  await evidence.check('同一插件卸载排在启用前：过期的启用请求不会把插件装回', async () => {
    // 知识库只远程分发：重新安装走已验签 catalog（夹具已启动本机开发 catalog）。
    const installed = await evaluate('window.electronAPI.plugins.installFromRemote("knowledge")');
    assert.equal(installed.success, true, JSON.stringify(installed));
    await run('wait', '--selector', knowledgeSidebar);
    const [removed, enabled] = await evaluate('Promise.all([window.electronAPI.plugins.uninstall("knowledge"),window.electronAPI.plugins.setEnabled("knowledge",true)])');
    assert.equal(removed.success, true, JSON.stringify(removed));
    assert.equal(enabled.success, false, JSON.stringify(enabled));
    await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
    assert.deepEqual(await list(), { knowledge: 'missing', slides: 'missing' });
    evidence.json('queued-enable-after-removal', { removed, enabled, row: compare('knowledge', false, false) });
    await run('shot');
  });
} catch (error) {
  failure = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  db?.close();
  if (failure && desktopLog) evidence.artifact(desktopLog, 'desktop');
  try { evidence.json('teardown', await test.finish({ clean: !failure })); }
  catch (error) { failure ??= error; evidence.error(error); }
  console.log(JSON.stringify(evidence.finish()));
}
if (failure) throw failure;
