import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { clickNamed, knowledgeSidebar, openKnowledgeStoreDetail } from './knowledgeStore.fixture.mjs';
import { KNOWLEDGE_BASE_SCHEMAS } from '../../../packages/plugins/knowledge/src/backend/database/schemas/knowledgeBase.ts';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('knowledge-default-install', { files: [
  'scripts/e2e/knowledge-plugin/default-install.acceptance.mjs',
  'scripts/e2e/knowledge-plugin/knowledgeStore.fixture.mjs',
] });
const test = acceptance(`knowledge-default-install-${process.pid}`, { evidence });
const { run } = test;
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
let failed;

function readState(up) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  try {
    return {
      installed: db.prepare("SELECT installed, user_removed FROM installed_plugins WHERE plugin_id='knowledge'").get() ?? null,
      docs: db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kb_documents'").get() ?? null,
      runtime: existsSync(join(up.root, 'plugins', 'knowledge', 'active.json')),
    };
  } finally { db.close(); }
}

function writeFixtureFile(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { flag: 'wx' });
}

function writeLegacyMetadata(workspaceDb, withDocument = false) {
  const db = new DatabaseSync(workspaceDb);
  try {
    for (const ddl of KNOWLEDGE_BASE_SCHEMAS) db.exec(ddl);
    db.exec("INSERT INTO knowledge_bases (id,name,created_at) VALUES ('default','E7 legacy default',0)");
    if (withDocument) db.exec(`INSERT INTO kb_documents (id,kb_id,filename,status,created_at)
      VALUES ('legacy-doc','default','metadata-only.md','failed','0')`);
  } finally { db.close(); }
}

try {
  const up = await start();
  await evidence.check('新用户：静默启动，不复制运行包、不写插件表，在市场可安装', async () => {
    assert.deepEqual(readState(up), { installed: null, docs: null, runtime: false });
    assert.equal(existsSync(join(up.root, 'plugins', 'knowledge')), false);
    await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
    await openKnowledgeStoreDetail(run, true);
    await run('wait', '--text', '未安装');
    await run('shot');
  });

  const derived = join(up.root, 'workspace', 'KnowledgeBase', 'qdrant', 'storage', 'empty-index-fixture');
  const source = join(up.root, 'workspace', 'KnowledgeBase', 'source_of_truth', 'legacy-source-fixture');
  await evidence.check('早期版本只有空库和派生占用：不装、不删，可清理', async () => {
    await run('stop');
    writeFixtureFile(derived, 'synthetic allocation for an empty index');
    writeLegacyMetadata(up.workspaceDb);
    const restarted = await start();
    assert.equal(readState(restarted).installed, null);
    assert.equal(readState(restarted).runtime, false);
    assert.ok(existsSync(derived));
    await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
    await openKnowledgeStoreDetail(run, true);
    await run('wait', '--text', '早期版本遗留数据');
    await run('wait', '--text', '可清理');
    await run('shot');
  });

  await evidence.check('旧资料存在时自动安装；用户卸载保留后不再自动装回，仍可手动安装', async () => {
    await run('stop');
    writeFixtureFile(source, 'pre-plugin source content');
    const restarted = await start();
    await run('wait', '--selector', knowledgeSidebar);
    assert.equal(readState(restarted).installed?.installed, 1);
    assert.equal(readState(restarted).runtime, true);
    assert.equal(readFileSync(source, 'utf8'), 'pre-plugin source content');
    await openKnowledgeStoreDetail(run);
    await run('shot');
    await clickNamed(run, 'button', '卸载', 'main');
    await clickNamed(run, 'button', '卸载', '.modal-overlay--alert');
    await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
    await run('stop');
    const removed = await start();
    assert.deepEqual({ ...readState(removed).installed }, { installed: 0, user_removed: 1 });
    assert.equal(readState(removed).runtime, false);
    assert.ok(existsSync(source));
    await openKnowledgeStoreDetail(run, true);
    await run('wait', '--text', '已卸载，保留数据');
    await run('shot');
    await clickNamed(run, 'button', '安装', 'main');
    await run('wait', '--selector', knowledgeSidebar);
    assert.deepEqual({ ...readState(removed).installed }, { installed: 1, user_removed: 0 });
    assert.equal(readFileSync(source, 'utf8'), 'pre-plugin source content');
    await run('shot');
  });
  await evidence.check('只有旧文档记录也自动安装，不丢失记录', async () => {
    await run('stop', '--clean');
    const fresh = await start();
    assert.equal(readState(fresh).installed, null);
    await run('stop');
    writeLegacyMetadata(fresh.workspaceDb, true);
    const restarted = await start();
    await run('wait', '--selector', knowledgeSidebar);
    assert.equal(readState(restarted).installed?.installed, 1);
    const db = new DatabaseSync(restarted.workspaceDb, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT filename FROM kb_documents WHERE id='legacy-doc'").get()?.filename, 'metadata-only.md');
    } finally { db.close(); }
    await openKnowledgeStoreDetail(run);
    await run('shot');
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try { evidence.json('teardown', await test.finish({ clean: !failed })); }
  catch (error) { failed ??= error; evidence.error(error); }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
