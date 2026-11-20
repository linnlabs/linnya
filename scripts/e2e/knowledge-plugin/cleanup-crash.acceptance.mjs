import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { observeTree, readProcessTable, sameProcess } from '../../development/features/desktop-probe/infrastructure/processTree.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { installKnowledgeForScenario } from './knowledgeStore.fixture.mjs';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('knowledge-cleanup-directory-crash', { files: [
  'scripts/e2e/knowledge-plugin/cleanup-crash.acceptance.mjs',
] });
const test = acceptance(`knowledge-cleanup-crash-${process.pid}`, { evidence });
const { run, probe } = test;
const selector = '.sidebar-entry:has(svg[data-icon="library"])';
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000');
const count = 5000;
let db;
let failed;

async function uiRef(role, label, within) {
  const { entries } = await run('snapshot', '--json', '--role', role, '--max-lines', '120', '--within', within);
  const hits = entries.filter(entry => entry.name === label);
  assert.equal(hits.length, 1, `Expected one ${role}: ${label}`);
  return hits[0].ref;
}

async function openDetail(tab) {
  await run('click', await uiRef('button', '插件', 'aside'));
  if (tab) await run('click', 'text=插件市场');
  await run('click', await uiRef('heading', '知识库', 'main'));
}

function readJSON(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function facts(root) {
  const plugin = join(root, 'plugins', 'knowledge');
  const data = join(root, 'workspace', 'Plugins', 'knowledge');
  const source = join(data, 'source_of_truth');
  return {
    installed: db.prepare("SELECT installed,version,schema_version,user_removed FROM installed_plugins WHERE plugin_id='knowledge'").get(),
    activeVersion: db.prepare("SELECT active_version,previous_version,status FROM plugin_active_versions WHERE plugin_id='knowledge'").get() ?? null,
    activePointer: readJSON(join(plugin, 'active.json')),
    removalMarker: readJSON(join(plugin, '.user-removed.json')),
    migrations: db.prepare("SELECT version,applied_at FROM plugin_migrations WHERE plugin_id='knowledge' ORDER BY version").all(),
    ownedTables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('kb_documents','knowledge_bases','project_knowledge_base_links','knowledge_graph_nodes','knowledge_graph_edges','knowledge_graph_doc_status','knowledge_graph_index_status','knowledge_graph_vector_doc_status') ORDER BY name").all(),
    enabled: db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='knowledge'").get() !== undefined,
    cleanup: db.prepare("SELECT status,completed_paths,error_code FROM plugin_cleanup_jobs WHERE plugin_id='knowledge'").get() ?? null,
    directories: existsSync(data) ? readdirSync(data).sort() : [],
    files: existsSync(source) ? readdirSync(source).length : 0,
  };
}

function checkDatabaseIntegrity() {
  const rows = db.prepare('PRAGMA quick_check').all();
  assert.deepEqual(rows.map(row => row.quick_check), ['ok']);
  return rows;
}

async function until(action, accepted, label, timeout = 10_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = action();
    if (accepted(value)) return value;
    await delay(20);
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

try {
  const up = await start();
  await installKnowledgeForScenario(run);
  assert.equal(up.pluginLoad, undefined, 'disk plugin must load');
  db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const source = join(up.root, 'workspace', 'Plugins', 'knowledge', 'source_of_truth');
  await mkdir(source, { recursive: true });
  const bytes = Buffer.alloc(4096, 65);
  // 只为打开一个可观测的删目录窗口，这批文件不是导入或检索性能样本。
  for (let startIndex = 0; startIndex < count; startIndex += 64) {
    await Promise.all(Array.from({ length: Math.min(64, count - startIndex) }, (_, index) =>
      writeFile(join(source, `synthetic-${startIndex + index}.dat`), bytes, { flag: 'wx' })));
  }
  await openDetail();
  await run('wait', '--text', '原文与解析结果');
  const initial = facts(up.root);
  assert.equal(initial.files, count);
  assert.equal(initial.installed.installed, 1);
  assert.ok(initial.migrations.length > 0);
  evidence.json('initial', { source: up.gitHead, ...initial });
  await run('shot');

  await evidence.check('已开始删目录时强杀，重启后保留一致残留并可从界面续清', async () => {
    await run('click', await uiRef('button', '卸载', 'main'));
    await run('click', '--selector', '.plugin-store-uninstall-dialog label');
    await run('shot');
    const confirm = await uiRef('button', '卸载并删除', '.modal-overlay--alert');
    // 与点击并行观察 SQLite 和真实文件。只有证明已经删掉一部分、且还没删完，才允许打断。
    const interaction = probe('click', confirm).catch(error => ({ message: error.message }));
    const checkpoint = await until(() => facts(up.root), state =>
      state.cleanup?.status === 'cleaning' && state.files > 0 && state.files < count, 'cleanup directory write checkpoint');
    const processes = readProcessTable();
    const backend = [...observeTree(up.electron, processes).values()]
      .find(entry => entry.parent === up.electron.pid && entry.command.endsWith('/dist/main/app-server-entry.cjs'));
    assert.ok(backend && sameProcess(backend, processes) && sameProcess(up.electron, processes), 'only kill the owned probe backend and Desktop');
    for (const owned of [backend, up.electron]) {
      assert.ok(sameProcess(owned));
      process.kill(owned.pid, 'SIGKILL');
    }
    evidence.json('crash-checkpoint', checkpoint);
    await interaction;
    db.close();
    db = undefined;
    await run('stop');
    const restarted = await start();
    assert.equal(restarted.workspaceDb, up.workspaceDb);
    db = new DatabaseSync(restarted.workspaceDb, { readOnly: true });
    await run('wait', '--selector', selector, '--state', 'detached');
    await openDetail('market');
    await run('wait', '--text', '数据残留');
    await run('shot');
    const recovered = facts(restarted.root);
    evidence.json('recovered', recovered);
    evidence.json('sqlite-after-process-kill', checkDatabaseIntegrity());
    assert.equal(recovered.installed.installed, 0);
    assert.equal(recovered.installed.user_removed, 1);
    assert.equal(recovered.enabled, false);
    assert.equal(recovered.activeVersion, null);
    assert.equal(recovered.activePointer, null);
    assert.ok(recovered.removalMarker);
    assert.deepEqual(recovered.migrations, initial.migrations);
    assert.deepEqual(recovered.ownedTables, initial.ownedTables);
    assert.equal(recovered.cleanup?.error_code, 'interrupted');
    assert.ok(recovered.files > 0 && recovered.files < count);
    await run('click', await uiRef('button', '重试', 'main'));
    await run('wait', '--text', '暂无本机数据');
    await run('shot');
    const final = facts(restarted.root);
    evidence.json('after-retry', final);
    evidence.json('sqlite-after-retry', checkDatabaseIntegrity());
    assert.equal(final.installed.schema_version, 0);
    assert.deepEqual(final.migrations, []);
    assert.deepEqual(final.ownedTables, []);
    assert.equal(final.cleanup, null);
    assert.equal(final.files, 0);
    assert.ok(final.removalMarker && final.installed.installed === 0 && !final.activePointer && !final.activeVersion);
  });
} catch (error) {
  failed = error;
  evidence.error(error);
  try { await run('shot'); } catch { /* 进程中断期间没有画面。 */ }
} finally {
  db?.close();
  try { evidence.json('cleanup', await test.finish({ clean: !failed })); } catch (error) { failed ??= error; evidence.error(error); }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
