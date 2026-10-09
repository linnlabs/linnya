import { it } from 'vitest';
import { createDurableFlowHarness, installRecoveryModelFixture } from './createDurableFlowHarness';
import { setPluginRuntimeStateForTests } from '../../../plugin-registry/pluginRuntimeState';
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
        throw new Error('SIGKILL must stop the fixture process');
      }
    })
  );
  const fixture = await createDurableFlowHarness(dbPath, [
    ...researchCarrierDraftTurns,
    ...researchCarrierFollowingTurns,
  ]);
  await fixture.flow.next(researchCarrierRequest(projectId), () => {});
  throw new Error('Crash boundary was not reached');
});
