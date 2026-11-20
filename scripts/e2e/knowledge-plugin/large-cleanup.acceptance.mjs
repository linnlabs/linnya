import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('knowledge-large-cleanup-interaction', {
  files: ['scripts/e2e/knowledge-plugin/large-cleanup.acceptance.mjs'],
});
const test = acceptance(`knowledge-large-cleanup-${process.pid}`, { evidence });
const { run, probe } = test;
const count = 20_000;
let db;
let error;

async function ref(name, role, within) {
  const { entries } = await run(
    'snapshot',
    '--json',
    '--role',
    role,
    '--max-lines',
    '150',
    '--within',
    within
  );
  const candidates = entries.filter(item => item.name === name);
  assert.equal(candidates.length, 1, `${role}: ${name}`);
  return candidates[0].ref;
}

try {
  const up = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
  assert.equal(up.pluginLoad, undefined, 'The bundled knowledge artifact must load');
  db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const source = join(up.root, 'workspace', 'Plugins', 'knowledge', 'source_of_truth');
  const bytes = Buffer.alloc(4096, 65);
  await mkdir(source, { recursive: true });
  for (let row = 0; row < count; row += 100)
    await Promise.all(
      Array.from({ length: 100 }, (_, offset) =>
        writeFile(join(source, `owned-fixture-${row + offset}.dat`), bytes, { flag: 'wx' })
      )
    );
  const filesRemaining = () => {
    try {
      return readdirSync(source).length;
    } catch (failure) {
      if (failure.code === 'ENOENT') return 0;
      throw failure;
    }
  };
  const cleanup = () =>
    db
      .prepare("SELECT status,error_code FROM plugin_cleanup_jobs WHERE plugin_id='knowledge'")
      .get() ?? null;
  await run('click', await ref('插件', 'button', 'aside'));
  await run('click', await ref('知识库', 'heading', 'main'));

  await evidence.check('20,000 个隔离文件：统计与页面采样交错、显示占用', async () => {
    const frames = await run(
      'eval',
      `new Promise(resolve => {
      const start = performance.now();
      requestAnimationFrame(first => requestAnimationFrame(second => resolve({ waitedMs: performance.now() - start, nextFrameMs: second - first })));
    })`
    );
    assert.ok(
      frames.value.waitedMs < 1000,
      `Renderer was blocked during storage calculation: ${JSON.stringify(frames)}`
    );
    await run('wait', '--selector', '.plugin-data-panel .is-installed');
    assert.equal(filesRemaining(), count);
    const stats = (await run('eval', "document.querySelector('.plugin-data-panel').innerText"))
      .value;
    assert.match(stats, /原文与解析结果/u);
    evidence.json('large-fixture-statistics', {
      count,
      fileSize: bytes.length,
      frames: frames.value,
      stats,
    });
    await run('shot');
  });

  await evidence.check('20,000 个隔离文件：清理期间可以从界面停止，并可重试完成', async () => {
    await run('click', await ref('卸载', 'button', 'main'));
    await run('click', '--selector', '.plugin-store-uninstall-dialog label');
    const confirm = await ref('卸载并删除', 'button', '.modal-overlay--alert');
    const interaction = probe('click', confirm);
    await run('wait', '--selector', '.plugin-data-panel .is-cleaning');
    const stop = await ref('停止', 'button', '.plugin-data-panel');
    // “清理中”包含先估算空间的阶段；必须看见实际删除，才验证删除途中点停。
    const deadline = Date.now() + 20_000;
    let remaining = filesRemaining();
    while (remaining === count) {
      assert.ok(Date.now() < deadline, 'Did not reach actual directory deletion');
      await delay(20);
      remaining = filesRemaining();
    }
    const during = { files: remaining, cleanup: cleanup() };
    assert.ok(during.files > 0 && during.cleanup?.status === 'cleaning');
    await run('click', stop);
    await interaction;
    await run('wait', '--selector', '.plugin-data-panel .is-failed');
    const stopped = { files: filesRemaining(), cleanup: cleanup() };
    evidence.json('stop-states', { during, stopped });
    assert.ok(stopped.files > 0 && stopped.files < count);
    assert.equal(stopped.cleanup?.error_code, 'interrupted');
    assert.equal(
      (
        await run(
          'eval',
          "Boolean(document.querySelector('.plugin-store-install-button:not([disabled])'))"
        )
      ).value,
      false
    );
    await run('shot');
    await run('click', await ref('重试', 'button', '.plugin-data-panel'));
    await run('wait', '--selector', '.plugin-data-panel .is-empty');
    assert.equal(filesRemaining(), 0);
    assert.equal(cleanup(), null);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    await run('shot');
  });
} catch (failure) {
  error = failure;
  if (!(failure instanceof assert.AssertionError)) evidence.error(failure);
} finally {
  db?.close();
  try {
    evidence.json('teardown', await test.finish({ clean: !error }));
  } catch (failure) {
    error ??= failure;
    evidence.error(failure);
  }
  console.log(JSON.stringify(evidence.finish()));
}
if (error) throw error;
