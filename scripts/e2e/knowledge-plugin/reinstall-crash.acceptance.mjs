import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('knowledge-reinstall-crash', { files: [
  'scripts/e2e/knowledge-plugin/reinstall-crash.acceptance.mjs',
  'scripts/e2e/knowledge-plugin/reinstall-crash.fixture.ts',
] });
const test = acceptance(`knowledge-reinstall-crash-${process.pid}`, { evidence });
const { run } = test;
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000');
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';
let failure;

async function click(role, name, within) {
  const { entries } = await run('snapshot', '--json', '--role', role, '--max-lines', '120', '--within', within);
  const match = entries.filter(entry => entry.name === name);
  assert.equal(match.length, 1, `Expected one ${role}: ${name}`);
  await run('click', match[0].ref);
}

function facts(up) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const pluginDir = join(up.root, 'plugins', 'knowledge');
  const dataDir = join(up.root, 'workspace', 'Plugins', 'knowledge');
  try {
    return {
      installed: db.prepare("SELECT installed, user_removed, schema_version FROM installed_plugins WHERE plugin_id='knowledge'").get(),
      enabled: Boolean(db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='knowledge'").get()),
      active: db.prepare("SELECT active_version, previous_version, status FROM plugin_active_versions WHERE plugin_id='knowledge'").get() ?? null,
      disk: existsSync(pluginDir) ? readdirSync(pluginDir).sort() : [],
      migrations: db.prepare("SELECT version, applied_at FROM plugin_migrations WHERE plugin_id='knowledge' ORDER BY version").all(),
      directories: existsSync(dataDir) ? readdirSync(dataDir).sort() : [],
      integrity: db.prepare('PRAGMA quick_check').get()?.quick_check,
    };
  } finally { db.close(); }
}

try {
  await evidence.check('随包重装写安装记录后进程崩溃，重启后必须一致且能继续操作', async () => {
    const up = await start();
    await run('wait', '--selector', sidebar);
    await click('button', '插件', 'aside');
    await click('heading', '知识库', 'main');
    await click('button', '卸载', 'main');
    const dedicated = await run('eval', "Boolean(document.querySelector('.plugin-store-uninstall-dialog'))");
    await click('button', dedicated.value ? '卸载' : '确定', '.modal-overlay--alert');
    await run('wait', '--selector', sidebar, '--state', 'detached');
    await run('shot');
    await run('stop');
    const before = facts(up);
    assert.equal(before.installed.installed, 0);
    assert.equal(before.installed.user_removed, 1);
    evidence.json('before-reinstall', before);
    // 写入窗口在一次同步 IPC 内太短，单独进程调用同一个产品安装入口，在真实写入点精确打断。
    const checkpointPath = join(up.root, 'reinstall-checkpoint.json');
    const target = fileURLToPath(new URL('./reinstall-crash.fixture.ts', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', 'tsx', target,
      up.workspaceDb, join(up.root, 'plugins'), join(up.repoRoot, 'extraResources', 'plugins'), checkpointPath],
    { cwd: up.repoRoot, encoding: 'utf8', timeout: 20_000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr || child.error?.message);
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    evidence.json('checkpoint', checkpoint);
    assert.equal(checkpoint.installed.installed, 1);
    assert.equal(checkpoint.enabled, true);
    assert.equal(checkpoint.active, null);
    assert.ok(facts(up).disk.includes('.user-removed.json'));

    const restarted = await start();
    assert.equal(restarted.workspaceDb, up.workspaceDb);
    await click('button', '插件', 'aside');
    const sidebarPresent = (await run('eval', `Boolean(document.querySelector(${JSON.stringify(sidebar)}))`)).value;
    if (facts(restarted).installed.installed === 0) await run('click', 'text=插件市场');
    await click('heading', '知识库', 'main');
    const surface = (await run('snapshot', '--json', '--max-lines', '120', '--within', 'main')).entries;
    const recovered = facts(restarted);
    evidence.json('after-restart', { recovered, sidebarPresent, surface });
    await run('shot');
    assert.equal(recovered.integrity, 'ok');
    assert.equal(recovered.installed.installed === 1, recovered.disk.includes('active.json'), '安装状态必须与激活指针一致');
    assert.equal(recovered.installed.installed === 1, recovered.active?.status === 'active', '安装状态必须与激活账本一致');
    assert.equal(recovered.installed.user_removed === 1, recovered.disk.includes('.user-removed.json'), '卸载标记必须一致');
    assert.deepEqual(recovered.directories, before.directories, '重装恢复不能删除保留数据');
    assert.deepEqual(recovered.migrations, before.migrations, '保留式卸载后的重装恢复不能重跑迁移');
    assert.equal(sidebarPresent, recovered.enabled, '侧栏必须跟随真实运行状态');
    if (!recovered.installed.installed) {
      await click('button', '安装', 'main');
      await run('wait', '--selector', sidebar);
      await run('shot');
      assert.equal(facts(restarted).active?.status, 'active', '回滚后必须可从商店重新安装');
    }
  });
} catch (error) {
  failure = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try { evidence.json('cleanup', await test.finish({ clean: !failure })); } catch (error) { failure ??= error; evidence.error(error); }
  console.log(JSON.stringify(evidence.finish()));
}
if (failure) throw failure;
