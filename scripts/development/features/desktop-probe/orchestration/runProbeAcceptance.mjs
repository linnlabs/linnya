import { fileURLToPath } from 'node:url';
import { createEvidence } from '../../../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { acceptance } from '../acceptance/probeAcceptance.mjs';
import { overviewScenario } from '../acceptance/overview.scenario.mjs';
import { repoRoot } from '../definitions/probeContract.mjs';
import { usage } from '../functions/parseProbeArgs.mjs';

export async function runProbeAcceptance(positionals) {
  if (positionals.length !== 1 || positionals[0] !== 'overview') usage('accept 需要一个已登记场景', '用 pnpm -s probe accept overview 验收导航、概览、菜单、列宽和 Slides 打开。其他业务按验收索引选择入口。');
  const evidence = createEvidence('desktop-overview', {
    root: repoRoot,
    files: [import.meta.url, '../acceptance/overview.scenario.mjs', '../acceptance/probeAcceptance.mjs', './probeFixtures.mjs']
      .map(file => fileURLToPath(new URL(file, import.meta.url))),
  });
  // 每次验收拥有新实例，不能复用用户正在调试的 default 或克隆数据。
  const test = acceptance(`accept-${process.pid}`, { evidence });
  let failed;
  try {
    await test.run('up', '--size', '1400x900', '--mode', 'dev');
    await overviewScenario(test, evidence);
  } catch (error) {
    failed = error;
    // check 内的失败已经记录；启动错误仍需单独列出。
    if (!evidence.data.checks.some(check => check.status === 'failed')) evidence.error(error);
    try { await test.run('shot'); }
    catch (captureError) { evidence.error(captureError); }
  } finally {
    try { evidence.json('cleanup', await test.finish({ clean: !failed })); }
    catch (error) { evidence.error(error); failed ??= error; }
  }
  const result = evidence.finish();
  return { ok: !failed, ...result, ...(failed ? { error: { code: failed.code ?? 'ACCEPTANCE_FAILED', message: failed.message } } : {}) };
}
