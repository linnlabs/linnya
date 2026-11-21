import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { clickNamed, installKnowledgeForScenario } from './knowledgeStore.fixture.mjs';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('knowledge-usage-cancellation', {
  files: ['scripts/e2e/knowledge-plugin/usage-cancellation.acceptance.mjs', 'scripts/e2e/knowledge-plugin/knowledgeStore.fixture.mjs'],
});
const test = acceptance(`knowledge-usage-cancellation-${process.pid}`, { evidence });
const { run } = test;
const panel = '.plugin-data-panel';
let failed;

try {
  await evidence.check('从商店停止实际在途统计，保留原文，重新统计后与 du 一致', async () => {
    const up = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
    await installKnowledgeForScenario(run);
    const source = join(up.root, 'workspace', 'Plugins', 'knowledge', 'source_of_truth');
    const files = 40_000;
    await mkdir(source, { recursive: true });
    const bytes = Buffer.alloc(4096, 65);
    for (let index = 0; index < files; index += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, offset) =>
        writeFile(join(source, `owned-usage-fixture-${index + offset}`), bytes, { flag: 'wx' })));
    }
    await clickNamed(run, 'button', '插件', 'aside');
    // 同一真实页面使用控件事件。在进入详情的第一帧观察并按停止，不能等扫描结束后再造暂停状态。
    const interacted = await run('eval', `new Promise(resolve => {
      const card = [...document.querySelectorAll('.plugin-store-card')]
        .find(el => el.querySelector('h2')?.textContent.trim() === '知识库');
      if (!card) return resolve(false);
      const until = performance.now() + 2500;
      function inspect() {
        const button = document.querySelector('.plugin-data-panel__measurement button');
        if (button?.getClientRects().length && button.textContent.trim() === '停止统计') {
          button.click();
          resolve(true);
        } else if (performance.now() < until) requestAnimationFrame(inspect);
        else resolve(false);
      }
      card.click();
      requestAnimationFrame(inspect);
    })`);
    assert.equal(interacted.value, true, 'No visible stop control during actual calculation');
    await run('wait', '--text', '已停止统计本机占用。');
    const read = () => run('eval', 'window.electronAPI.plugins.getDetail("knowledge")');
    const paused = (await read()).value.data;
    assert.equal(paused.dataMeasurement, 'paused');
    assert.equal((await read()).value.data.dataMeasurement, 'paused', 'Reading status must not restart cancelled scanning');
    assert.equal((await readdir(source)).length, files);
    await run('shot');
    await run('click', '--selector', '.plugin-store-back-button');
    await clickNamed(run, 'heading', '知识库', 'main');
    await run('wait', '--text', '已停止统计本机占用。');
    await clickNamed(run, 'button', '重新统计', panel);
    await run('wait', '--selector', `${panel} .is-installed`);
    await run('wait', '--selector', `${panel} .plugin-data-panel__measurement`, '--state', 'detached');
    const resumed = (await read()).value.data;
    assert.equal(resumed.dataMeasurement, undefined);
    const measured = Number(execFileSync('du', ['-s', '-k', source], { encoding: 'utf8' }).split(/\s/u)[0]) * 1024;
    assert.equal(resumed.data.directories.source, measured);
    assert.equal((await readdir(source)).length, files);
    evidence.json('scan-state', { paused: paused.dataMeasurement, measured, reported: resumed.data, files });
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
