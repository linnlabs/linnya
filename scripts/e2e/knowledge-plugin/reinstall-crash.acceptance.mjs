import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { clickNamed, installKnowledgeForScenario, openKnowledgeStoreDetail } from './knowledgeStore.fixture.mjs';

const [mode = 'reinstall', checkpointName = 'after-install-record'] = process.argv.slice(2);
const uncommitted = ['after-stage', 'after-install-record', 'during-migration', 'before-commit'];
const checkpoints = mode === 'install'
  ? [...uncommitted, 'before-pointer', 'after-pointer']
  : ['after-stage', 'after-install-record', 'before-commit', 'before-pointer', 'after-pointer', 'before-removal-marker', 'after-removal-marker'];
assert.ok(['install', 'reinstall'].includes(mode) && checkpoints.includes(checkpointName));
const committed = !uncommitted.includes(checkpointName);
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence(`knowledge-${mode}-${checkpointName}`, { files: [
  'scripts/e2e/knowledge-plugin/reinstall-crash.acceptance.mjs',
  'scripts/e2e/knowledge-plugin/reinstall-crash.fixture.ts',
] });
const test = acceptance(`knowledge-reinstall-crash-${process.pid}`, { evidence });
const { run } = test;
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000');
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';
const retainedLibrary = 'E7 interrupted reinstall orchard';
const retainedSource = 'Synthetic source to verify the retained bytes across the interrupted reinstall.';
let failure;

const click = (...args) => clickNamed(run, ...args);

function facts(up) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const pluginDir = join(up.root, 'plugins', 'knowledge');
  const dataDir = join(up.root, 'workspace', 'Plugins', 'knowledge');
  try {
    return {
      installed: db.prepare("SELECT installed, version, user_removed, schema_version FROM installed_plugins WHERE plugin_id='knowledge'").get() ?? null,
      enabled: Boolean(db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='knowledge'").get()),
      active: db.prepare("SELECT active_version, previous_version, status FROM plugin_active_versions WHERE plugin_id='knowledge'").get() ?? null,
      disk: existsSync(pluginDir) ? readdirSync(pluginDir).sort() : [],
      pointer: existsSync(join(pluginDir, 'active.json')) ? JSON.parse(readFileSync(join(pluginDir, 'active.json'), 'utf8')) : null,
      removal: existsSync(join(pluginDir, '.user-removed.json')) ? JSON.parse(readFileSync(join(pluginDir, '.user-removed.json'), 'utf8')) : null,
      migrations: db.prepare("SELECT version, applied_at FROM plugin_migrations WHERE plugin_id='knowledge' ORDER BY version").all(),
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name),
      library: db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_bases'").get()
        ? db.prepare('SELECT id, name FROM knowledge_bases WHERE name=?').get(retainedLibrary) ?? null : null,
      directories: existsSync(dataDir) ? readdirSync(dataDir).sort() : [],
      source: existsSync(join(dataDir, 'source_of_truth', 'interruption-marker.txt'))
        ? readFileSync(join(dataDir, 'source_of_truth', 'interruption-marker.txt'), 'utf8') : null,
      integrity: db.prepare('PRAGMA quick_check').get()?.quick_check,
    };
  } finally { db.close(); }
}

try {
  await evidence.check(`远程${mode}在${checkpointName}强杀，重启后状态一致且可使用`, async () => {
    const up = await start();
    if (mode === 'reinstall') {
      await installKnowledgeForScenario(run);
      await run('click', '--selector', sidebar);
      await click('button', '新建知识库', '.kb-list-header');
      await run('click', '--selector', '#new-kb-name');
      await run('type', retainedLibrary);
      await click('button', '创建', '.modal-overlay');
      await run('wait', '--text', retainedLibrary);
      const directory = join(up.root, 'workspace', 'Plugins', 'knowledge', 'source_of_truth');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'interruption-marker.txt'), retainedSource, { flag: 'wx' });
      await openKnowledgeStoreDetail(run);
      await run('wait', '--selector', '.plugin-data-panel .is-installed');
      await click('button', '卸载', 'main');
      await click('button', '卸载', '.modal-overlay--alert');
    } else {
      await openKnowledgeStoreDetail(run, true);
      await run('wait', '--selector', '.plugin-store-install-button:not([disabled])');
    }
    await run('wait', '--selector', sidebar, '--state', 'detached');
    await run('shot');
    await run('stop');
    const before = facts(up);
    assert.equal(before.installed?.installed ?? 0, 0);
    assert.equal(before.installed?.user_removed ?? 0, mode === 'reinstall' ? 1 : 0);
    if (mode === 'reinstall') {
      assert.ok(before.library);
      assert.equal(before.source, retainedSource);
    }
    evidence.json('before-install', before);
    // 写入窗口在一次同步 IPC 内太短，单独进程调用同一个产品安装入口，在真实写入点精确打断。
    const checkpointPath = join(up.root, 'reinstall-checkpoint.json');
    const target = fileURLToPath(new URL('./reinstall-crash.fixture.ts', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', 'tsx', target,
      up.workspaceDb, join(up.root, 'plugins'), join(up.root, 'user-data', 'runtimes'), checkpointPath, checkpointName],
    { cwd: up.repoRoot, encoding: 'utf8', timeout: 120_000, env: process.env });
    assert.equal(child.signal, 'SIGKILL', child.stderr || child.error?.message);
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    evidence.json('checkpoint', checkpoint);
    assert.equal(checkpoint.checkpoint, checkpointName);
    assert.equal(checkpoint.inTransaction, !committed && checkpointName !== 'after-stage');
    const killed = facts(up);
    evidence.json('after-kill', killed);
    assert.equal(killed.integrity, 'ok');
    assert.equal(killed.installed?.installed ?? 0, committed ? 1 : 0);
    if (!committed) {
      assert.deepEqual(killed.tables, before.tables);
      assert.deepEqual(killed.migrations, before.migrations);
      assert.deepEqual(killed.removal, before.removal);
      assert.equal(killed.active, null);
      assert.equal(killed.pointer, null);
    } else {
      assert.equal(killed.active?.status, checkpointName.endsWith('-pointer') ? 'activating' : 'active');
      assert.equal(Boolean(killed.pointer), checkpointName !== 'before-pointer');
      assert.equal(Boolean(killed.removal), mode === 'reinstall' && checkpointName !== 'after-removal-marker');
      assert.ok(killed.migrations.length > 0);
    }

    const restarted = await start();
    assert.equal(restarted.workspaceDb, up.workspaceDb);
    if (committed) await run('wait', '--selector', sidebar);
    const sidebarPresent = (await run('eval', `Boolean(document.querySelector(${JSON.stringify(sidebar)}))`)).value;
    await openKnowledgeStoreDetail(run, !committed);
    const surface = (await run('snapshot', '--json', '--max-lines', '120', '--within', 'main')).entries;
    const recovered = facts(restarted);
    evidence.json('after-restart', { recovered, sidebarPresent, surface });
    await run('shot');
    assert.equal(recovered.integrity, 'ok');
    assert.equal(recovered.installed?.installed ?? 0, committed ? 1 : 0);
    assert.equal(Boolean(recovered.pointer), committed);
    assert.equal(recovered.active?.status === 'active', committed);
    assert.equal(Boolean(recovered.removal), mode === 'reinstall' && !committed);
    assert.equal(sidebarPresent, committed);
    assert.equal(recovered.enabled, committed);
    assert.deepEqual(recovered.migrations, committed ? killed.migrations : before.migrations);
    if (mode === 'reinstall') {
      assert.deepEqual(recovered.directories, before.directories, '重装恢复不能删除保留数据');
      assert.deepEqual(recovered.migrations, before.migrations, '保留式卸载后的重装恢复不能重跑迁移');
      assert.deepEqual(recovered.library, before.library);
      assert.equal(recovered.source, before.source);
    }
    if (!committed) {
      await click('button', '安装', 'main');
      await run('wait', '--selector', sidebar);
    }
    await run('click', '--selector', sidebar);
    await run('wait', '--text', mode === 'reinstall' ? retainedLibrary : '默认知识库');
    await run('shot');
    const ready = facts(restarted);
    assert.equal(ready.active?.status, 'active');
    assert.deepEqual(ready.migrations.map(row => row.version), [1]);
    assert.equal(ready.removal, null);
    assert.deepEqual(ready.library, before.library);
    assert.equal(ready.source, before.source);
    evidence.json('after-usable', ready);
  });
} catch (error) {
  failure = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try { evidence.json('cleanup', await test.finish({ clean: !failure })); } catch (error) { failure ??= error; evidence.error(error); }
  console.log(JSON.stringify(evidence.finish()));
}
if (failure) throw failure;
