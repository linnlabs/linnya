import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { publishNewerDevPluginVersion } from '../plugin-remote/publishNewerDevPluginVersion.mjs';
import { clickNamed, installKnowledgeForScenario, knowledgeCatalog, knowledgeSidebar, openKnowledgeStoreDetail } from './knowledgeStore.fixture.mjs';

/**
 * 知识库只远程分发：升级来自已验签 catalog 上的更高版本（带一条合成迁移）。
 * 精确断点在独立进程里调用与商店“更新”相同的远程安装入口并强杀；其余场景从真实商店操作。
 * 只改 dist/dev-plugin-catalog 这一构建输出，结束时恢复，不需要独立检出。
 */
const mode = process.argv[2];
const preciseModes = ['during-migration', 'before-commit', 'before-pointer', 'after-pointer'];
const faultModes = { 'artifact-missing': 'missing', 'artifact-digest-mismatch': 'digest-mismatch', 'artifact-truncated': 'truncated' };
const modes = [...preciseModes, 'store-update', 'rejected-migration', 'removed-before-upgrade', ...Object.keys(faultModes)];
assert.ok(modes.includes(mode), `Specify one upgrade case: ${modes.join(', ')}`);
const uncommitted = ['during-migration', 'before-commit'].includes(mode);
const precise = preciseModes.includes(mode);
const fault = faultModes[mode] ?? null;
const library = 'Library created before the plugin upgrade';
const origin = new URL(knowledgeCatalog.url).origin;

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence(`knowledge-upgrade-${mode}`, {
  files: [
    'scripts/e2e/knowledge-plugin/upgrade-checkpoint.acceptance.mjs',
    'scripts/e2e/knowledge-plugin/upgrade-checkpoint.fixture.ts',
    'scripts/e2e/plugin-remote/publishNewerDevPluginVersion.mjs',
  ],
});
const test = acceptance(`knowledge-upgrade-checkpoint-${process.pid}`, { evidence });
const { run } = test;
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
let published;
let failed;

function optional(read) {
  try {
    return read();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function facts(up, file) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const plugin = join(up.root, 'plugins', 'knowledge');
  try {
    return {
      installed: { ...db.prepare("SELECT installed,version,schema_version,user_removed FROM installed_plugins WHERE plugin_id='knowledge'").get() },
      enabled: Boolean(db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='knowledge'").get()),
      active: { ...(db.prepare("SELECT active_version,previous_version,status FROM plugin_active_versions WHERE plugin_id='knowledge'").get() ?? {}) },
      pointer: optional(() => JSON.parse(readFileSync(join(plugin, 'active.json'), 'utf8'))),
      removed: optional(() => JSON.parse(readFileSync(join(plugin, '.user-removed.json'), 'utf8'))),
      migrations: db.prepare("SELECT version,applied_at FROM plugin_migrations WHERE plugin_id='knowledge' ORDER BY version").all().map(row => ({ ...row })),
      libraries: db.prepare('SELECT id,name FROM knowledge_bases ORDER BY id').all().map(row => ({ ...row })),
      column: Boolean(db.prepare("SELECT name FROM pragma_table_info('knowledge_bases') WHERE name='upgrade_acceptance'").get()),
      source: readFileSync(file, 'utf8'),
      integrity: db.prepare('PRAGMA quick_check').get().quick_check,
    };
  } finally {
    db.close();
  }
}

function assertNewVersion(state, initial, checkpoint) {
  assert.equal(state.installed.version, published.version);
  assert.equal(state.installed.installed, 1);
  assert.equal(state.enabled, true);
  assert.equal(state.installed.user_removed, 0);
  assert.equal(state.installed.schema_version, published.migrationVersion);
  assert.equal(state.removed, null);
  assert.equal(state.active.status, 'active');
  assert.equal(state.active.active_version, published.version);
  assert.equal(state.pointer.version, published.version);
  const previous = mode === 'removed-before-upgrade' ? null : initial.installed.version;
  assert.equal(state.active.previous_version, previous);
  assert.equal(state.pointer.previousVersion ?? null, previous);
  assert.deepEqual(state.migrations.map(row => row.version), [...initial.migrations.map(row => row.version), published.migrationVersion]);
  assert.deepEqual(state.migrations.slice(0, initial.migrations.length), initial.migrations, 'committed migrations must not run again');
  if (checkpoint?.column) assert.deepEqual(state.migrations.at(-1), checkpoint.migrations.at(-1), 'a committed migration must not run again');
  assert.equal(state.column, true);
  assert.equal(state.integrity, 'ok');
  assert.deepEqual(state.libraries, initial.libraries);
  assert.equal(state.source, initial.source);
}

/** 打开已安装知识库的详情：商店进入时刷新 catalog，出现“更新”后点击。 */
async function clickStoreUpdate() {
  await openKnowledgeStoreDetail(run);
  await run('wait', '--selector', '.plugin-store-update-button:not([disabled])', '--timeout', '30000');
  await run('shot');
  await clickNamed(run, 'button', '更新', 'main');
}

async function readNotifications() {
  await run('wait', '--selector', '.notification-content', '--timeout', '60000');
  return (await run('eval', "[...document.querySelectorAll('.notification-content')].map(node => node.textContent.trim())")).value;
}

async function assertLibraryVisible() {
  await run('click', '--selector', '.plugin-store-back-button').catch(() => {});
  await run('wait', '--selector', knowledgeSidebar, '--timeout', '60000');
  await run('click', '--selector', knowledgeSidebar);
  await run('wait', '--text', library);
  await run('shot');
}

const checkName = fault
  ? `远程更新包故障 ${mode}：拒绝更新、旧版本与资料不变、修复后可重试`
  : `远程升级 ${mode}：激活、迁移、原资料及界面一致`;
try {
  await evidence.check(checkName, async () => {
    const up = await start();
    await installKnowledgeForScenario(run);
    await run('wait', '--selector', knowledgeSidebar);
    await run('click', '--selector', knowledgeSidebar);
    await run('wait', '--text', '新建知识库');
    await clickNamed(run, 'button', '新建知识库', '.kb-list-header');
    await run('click', '--selector', '#new-kb-name');
    await run('type', library);
    await clickNamed(run, 'button', '创建', '.modal-overlay');
    await run('wait', '--text', library);
    await run('shot');
    const file = join(up.root, 'workspace', 'Plugins', 'knowledge', 'source_of_truth', 'upgrade-existing-source.txt');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'existing pre-upgrade content', { flag: 'wx' });
    if (mode === 'removed-before-upgrade') {
      await openKnowledgeStoreDetail(run);
      await run('wait', '--selector', '.plugin-data-panel .is-installed');
      await clickNamed(run, 'button', '卸载', 'main');
      await clickNamed(run, 'button', '卸载', '.modal-overlay--alert');
      await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
      await run('shot');
    }
    const initial = facts(up, file);
    assert.ok(initial.libraries.some(item => item.name === library));
    evidence.json('older-version-state', initial);
    published = publishNewerDevPluginVersion({
      pluginId: 'knowledge', origin, rejectMigration: mode === 'rejected-migration', fault,
    });
    evidence.json('published-version', { older: initial.installed.version, newer: published.version, migration: published.migrationVersion, fault });

    if (precise) {
      await run('stop');
      const trap = join(up.root, 'upgrade-checkpoint.json');
      const result = spawnSync(process.execPath, [
        '--import', 'tsx', fileURLToPath(new URL('./upgrade-checkpoint.fixture.ts', import.meta.url)),
        up.workspaceDb, join(up.root, 'plugins'), join(up.root, 'user-data', 'runtimes'), trap, mode,
      ], { cwd: up.repoRoot, timeout: 120_000, encoding: 'utf8', env: process.env });
      assert.equal(result.signal, 'SIGKILL', result.stderr || result.error?.message || result.stdout);
      const recorded = JSON.parse(readFileSync(trap, 'utf8'));
      const checkpoint = facts(up, file);
      evidence.json('immediate-recovery-facts', { recorded, checkpoint });
      assert.equal(recorded.checkpoint, mode);
      assert.equal(recorded.inTransaction, uncommitted);
      if (uncommitted) assert.deepEqual(checkpoint, initial, 'an uncommitted upgrade must leave everything as before');
      else {
        assert.equal(checkpoint.installed.version, published.version);
        assert.equal(checkpoint.installed.schema_version, published.migrationVersion);
        assert.equal(checkpoint.active.status, 'activating');
        assert.equal(checkpoint.pointer.version, mode === 'before-pointer' ? initial.installed.version : published.version);
      }
      const restarted = await start();
      assert.equal(restarted.workspaceDb, up.workspaceDb);
      if (uncommitted) {
        // 未提交：重启后仍是旧版本且可用；用户从商店再次更新，已解压的新版本目录可复用。
        assert.deepEqual(facts(restarted, file), initial);
        await clickStoreUpdate();
        await run('wait', '--selector', '.plugin-store-update-button', '--state', 'detached', '--timeout', '60000');
      }
      await run('wait', '--selector', knowledgeSidebar, '--timeout', '60000');
      const state = facts(restarted, file);
      evidence.json('recovered-state', state);
      assertNewVersion(state, initial, uncommitted ? undefined : checkpoint);
      await assertLibraryVisible();
      return;
    }

    if (mode === 'removed-before-upgrade') {
      await run('click', '--selector', '.plugin-store-back-button');
      await run('click', 'text=插件市场');
      await clickNamed(run, 'heading', '知识库', 'main');
      await run('wait', '--text', '已卸载，保留数据');
      await clickNamed(run, 'button', '安装', 'main');
      await run('wait', '--selector', knowledgeSidebar, '--timeout', '60000');
      const state = facts(up, file);
      evidence.json('reinstalled-newer-state', state);
      assertNewVersion(state, initial);
      await assertLibraryVisible();
      return;
    }

    await clickStoreUpdate();
    if (mode === 'store-update') {
      const notifications = await readNotifications();
      await run('shot');
      const state = facts(up, file);
      const { value: store } = await run('eval', 'window.electronAPI.plugins.storeList()');
      evidence.json('updated-state', { notifications, state, store: store.data?.items?.find(item => item.meta.id === 'knowledge') });
      assertNewVersion(state, initial);
      await run('wait', '--selector', '.plugin-store-update-button', '--state', 'detached', '--timeout', '30000');
      await assertLibraryVisible();
      return;
    }

    const notifications = await readNotifications();
    const after = facts(up, file);
    // 通知只说更新失败；具体原因在详情页内联显示，旧版本仍在、按钮可重试。
    await run('wait', '--selector', '.plugin-store-install-error', '--timeout', '30000');
    const reason = (await run('eval', "document.querySelector('.plugin-store-install-error')?.textContent.trim() ?? ''")).value;
    evidence.json('failed-update-state', { notifications, reason, after });
    await run('shot');
    assert.deepEqual(after, initial, 'a failed update must leave the installed version, activation and data unchanged');
    assert.ok(notifications.some(message => /插件更新失败/u.test(message)), JSON.stringify(notifications));
    const expectedReason = { 'rejected-migration': /./u, 'artifact-missing': /插件服务暂时不可用|网络/u }[mode] ?? /完整性校验/u;
    assert.match(reason, expectedReason);
    await run('wait', '--selector', knowledgeSidebar);
    if (mode === 'rejected-migration') {
      await assertLibraryVisible();
      return;
    }
    // 发布方修好服务器上的包后，同一个更新按钮可以重试成功。
    published.repairArtifact();
    await run('click', '--selector', '.plugin-store-update-button');
    await run('wait', '--selector', '.plugin-store-update-button', '--state', 'detached', '--timeout', '60000');
    const repaired = facts(up, file);
    evidence.json('repaired-update-state', repaired);
    assertNewVersion(repaired, initial);
    await assertLibraryVisible();
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try {
    published?.restore();
    evidence.json('teardown', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ??= error;
    evidence.error(error);
  }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
