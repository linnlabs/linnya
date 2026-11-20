import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';

const checkpoint = process.argv[2];
const checkpoints = [
  'uninstall-before-intent',
  'uninstall-before-marker',
  'cleanup-before-commit',
  'cleanup-after-commit',
];
assert.ok(checkpoints.includes(checkpoint), `Specify one checkpoint: ${checkpoints.join(', ')}`);
const cleanup = checkpoint.startsWith('cleanup-');
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence(`knowledge-${checkpoint}`, {
  files: [
    'scripts/e2e/knowledge-plugin/lifecycle-checkpoint.acceptance.mjs',
    'scripts/e2e/knowledge-plugin/lifecycle-checkpoint.fixture.ts',
  ],
});
const test = acceptance(`knowledge-lifecycle-${process.pid}`, { evidence });
const { run } = test;
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000');
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';
const libraryName = 'E7 lifecycle checkpoint sample';
let failed;

async function click(role, label, within) {
  const { entries } = await run(
    'snapshot',
    '--json',
    '--role',
    role,
    '--max-lines',
    '120',
    '--within',
    within
  );
  const targets = entries.filter(entry => entry.name === label);
  assert.equal(targets.length, 1, `Expected one ${role}: ${label}`);
  await run('click', targets[0].ref);
}

async function openDetail(market) {
  await click('button', '插件', 'aside');
  if (market) await run('click', 'text=插件市场');
  await click('heading', '知识库', 'main');
}

function optional(read) {
  try {
    return read();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readFacts(up, manifest, sourceFile) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const plugin = join(up.root, 'plugins', 'knowledge');
  try {
    const ownedTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(row => row.name)
      .filter(name => manifest.ownedTables.includes(name));
    return {
      installed: db
        .prepare(
          "SELECT installed, version, user_removed, schema_version FROM installed_plugins WHERE plugin_id='knowledge'"
        )
        .get(),
      enabled: Boolean(
        db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='knowledge'").get()
      ),
      active:
        db
          .prepare(
            "SELECT active_version, previous_version, status FROM plugin_active_versions WHERE plugin_id='knowledge'"
          )
          .get() ?? null,
      pointer: optional(() => JSON.parse(readFileSync(join(plugin, 'active.json'), 'utf8'))),
      removal: optional(() => JSON.parse(readFileSync(join(plugin, '.user-removed.json'), 'utf8'))),
      artifacts: (optional(() => readdirSync(plugin)) ?? []).sort(),
      cleanup:
        db
          .prepare(
            "SELECT status, completed_paths, error_code FROM plugin_cleanup_jobs WHERE plugin_id='knowledge'"
          )
          .get() ?? null,
      migrations: db
        .prepare(
          "SELECT version, applied_at FROM plugin_migrations WHERE plugin_id='knowledge' ORDER BY version"
        )
        .all(),
      ownedTables,
      libraries: ownedTables.includes('knowledge_bases')
        ? db.prepare('SELECT id, name FROM knowledge_bases ORDER BY id').all()
        : [],
      source: optional(() => readFileSync(sourceFile, 'utf8')),
      integrity: db
        .prepare('PRAGMA quick_check')
        .all()
        .map(row => row.quick_check),
    };
  } finally {
    db.close();
  }
}

async function uninstallKeepingData() {
  await openDetail(false);
  await run('wait', '--text', '原文与解析结果');
  await click('button', '卸载', 'main');
  await click('button', '卸载', '.modal-overlay--alert');
  await run('wait', '--selector', sidebar, '--state', 'detached');
  await run('wait', '--selector', '.plugin-data-panel .is-retained');
  await run('shot');
}

function checkUninstalled(state) {
  assert.equal(state.installed.installed, 0);
  assert.equal(state.installed.user_removed, 1);
  assert.equal(state.enabled, false);
  assert.equal(state.active, null);
  assert.equal(state.pointer, null);
  assert.equal(state.removal?.pluginId, 'knowledge');
  assert.deepEqual(state.artifacts, ['.user-removed.json']);
}

function checkCleaned(state) {
  checkUninstalled(state);
  assert.equal(state.installed.schema_version, 0);
  assert.equal(state.cleanup, null);
  assert.deepEqual(state.migrations, []);
  assert.deepEqual(state.ownedTables, []);
  assert.equal(state.source, null);
}

try {
  await evidence.check(
    `真实方案 ${checkpoint} 强杀后，Desktop 恢复后的界面和持久状态一致`,
    async () => {
      const up = await start();
      await run('wait', '--selector', sidebar);
      await run('click', '--selector', sidebar);
      await click('button', '新建知识库', 'main');
      await run('click', '--selector', '#new-kb-name');
      await run('type', libraryName);
      await click('button', '创建', '.modal-overlay');
      await run('wait', '--text', libraryName);
      const dataDir = join(up.root, 'workspace', 'Plugins', 'knowledge', 'source_of_truth');
      const sourceFile = join(dataDir, 'checkpoint-fixture.txt');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(
        sourceFile,
        'This isolated source must survive an uninstall without data cleanup.\n'.repeat(128),
        { flag: 'wx' }
      );
      const manifestPath = join(
        up.repoRoot,
        'extraResources',
        'plugins',
        'knowledge',
        'plugin.json'
      );
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      await run('shot');
      if (cleanup) await uninstallKeepingData();
      await run('stop');
      const initial = readFacts(up, manifest, sourceFile);
      assert.ok(initial.libraries.some(item => item.name === libraryName));
      assert.ok(initial.source && initial.migrations.length && initial.ownedTables.length);
      evidence.json('before-crash', initial);

      const child = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('./lifecycle-checkpoint.fixture.ts', import.meta.url)),
          checkpoint,
          up.root,
          manifestPath,
          up.workspaceDb,
        ],
        { cwd: up.repoRoot, encoding: 'utf8', timeout: 20_000 }
      );
      assert.equal(child.signal, 'SIGKILL', child.stderr || child.error?.message);
      const marker = JSON.parse(readFileSync(join(up.root, 'lifecycle-checkpoint.json'), 'utf8'));
      assert.equal(marker.step, checkpoint);
      if (cleanup) assert.equal(marker.inTransaction, checkpoint === 'cleanup-before-commit');
      const stopped = readFacts(up, manifest, sourceFile);
      assert.deepEqual(stopped.integrity, ['ok']);
      evidence.json('after-kill-before-desktop', { marker, stopped });

      const restarted = await start();
      assert.equal(restarted.workspaceDb, up.workspaceDb);
      const recovered = readFacts(restarted, manifest, sourceFile);
      const sidebarPresent = (
        await run('eval', `Boolean(document.querySelector(${JSON.stringify(sidebar)}))`)
      ).value;
      await openDetail(!sidebarPresent);
      await run('shot');
      evidence.json('after-desktop-restart', { sidebarPresent, recovered });
      assert.deepEqual(recovered.integrity, ['ok']);

      if (checkpoint === 'uninstall-before-intent') {
        assert.equal(
          sidebarPresent,
          true,
          'Uncommitted uninstall must leave the previously enabled plugin running'
        );
        assert.deepEqual(recovered, initial, 'Uncommitted uninstall must preserve all facts');
      } else if (checkpoint === 'uninstall-before-marker') {
        assert.equal(sidebarPresent, false);
        checkUninstalled(recovered);
        assert.equal(recovered.source, initial.source);
        assert.deepEqual(recovered.migrations, initial.migrations);
        assert.deepEqual(recovered.libraries, initial.libraries);
        await run('wait', '--selector', '.plugin-data-panel .is-retained');
        await click('button', '安装', 'main');
        await run('wait', '--selector', sidebar);
        await run('shot');
        const reinstalled = readFacts(restarted, manifest, sourceFile);
        assert.equal(reinstalled.removal, null);
        assert.equal(reinstalled.active?.status, 'active');
        assert.deepEqual(reinstalled.libraries, initial.libraries);
        assert.deepEqual(reinstalled.migrations, initial.migrations);
        assert.equal(reinstalled.source, initial.source);
        evidence.json('reinstalled', reinstalled);
      } else if (checkpoint === 'cleanup-before-commit') {
        checkUninstalled(recovered);
        assert.equal(sidebarPresent, false);
        assert.equal(
          stopped.source,
          null,
          'Files were already removed at the transaction boundary'
        );
        assert.equal(stopped.cleanup?.status, 'cleaning');
        assert.equal(recovered.cleanup?.status, 'failed');
        assert.equal(recovered.cleanup?.error_code, 'interrupted');
        assert.equal(recovered.source, null);
        assert.deepEqual(recovered.ownedTables, initial.ownedTables);
        assert.deepEqual(recovered.migrations, initial.migrations);
        assert.deepEqual(recovered.libraries, initial.libraries);
        await run('wait', '--text', '数据残留');
        await run('shot');
        await click('button', '重试', 'main');
        await run('wait', '--text', '暂无本机数据');
        await run('shot');
        const retried = readFacts(restarted, manifest, sourceFile);
        checkCleaned(retried);
        assert.deepEqual(retried.integrity, ['ok']);
        evidence.json('after-retry', retried);
      } else {
        assert.equal(sidebarPresent, false);
        checkCleaned(stopped);
        checkCleaned(recovered);
        await run('wait', '--text', '暂无本机数据');
        await run('shot');
      }
    }
  );
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try {
    evidence.json('teardown', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ??= error;
    evidence.error(error);
  }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
