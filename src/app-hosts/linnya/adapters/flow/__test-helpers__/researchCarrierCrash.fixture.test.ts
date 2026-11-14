import { it } from 'vitest';
import { createDurableFlowHarness, installRecoveryModelFixture } from './createDurableFlowHarness';
import { setPluginRuntimeStateForTests } from '../../../plugin-registry/pluginRuntimeState';
import { markFlowCrashFixtureReady } from './runFlowCrashFixture';
import {
  installResearchCarrierFixture,
  ResearchCarrierFixtureTool,
  researchCarrierRequest,
  researchCarrierDraftTurns,
  researchCarrierFollowingTurns,
} from './researchCarrierFixture';

/** 由外层进程验收选择：SIGKILL 不执行 finally，验证 SQLite 已提交边界。 */
it.skipIf(!process.env.LINNYA_CARRIER_CRASH_DB)('crash at a fixed child handoff', async () => {
  const dbPath = process.env.LINNYA_CARRIER_CRASH_DB;
  const projectId = process.env.LINNYA_CARRIER_CRASH_PROJECT;
  const boundary = process.env.LINNYA_CARRIER_CRASH_BOUNDARY;
  if (!dbPath || !projectId || !boundary) throw new Error('Missing crash fixture input');
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
  installResearchCarrierFixture(
    new ResearchCarrierFixtureTool(async point => {
      if (point === boundary) {
        process.kill(process.pid, 'SIGKILL');
        // worker 发出的进程信号不是同步控制流屏障：高并发下，紧随其后的 throw
        // 可能先被 ToolNode 持久化成真实错误。此处停止推进，只等待 OS 终止整个进程。
        await new Promise<never>(() => {});
      }
    })
  );
  const fixture = await createDurableFlowHarness(dbPath, [
    ...researchCarrierDraftTurns,
    ...researchCarrierFollowingTurns,
  ]);
  await markFlowCrashFixtureReady();
  await fixture.flow.next(researchCarrierRequest(projectId), () => {});
  throw new Error('Crash boundary was not reached');
}, 20_000);
