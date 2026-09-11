import { it } from 'vitest';
import { createDurableFlowHarness, installRecoveryModelFixture } from './createDurableFlowHarness';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import type { ToolContext } from 'src/tools/types';
import { setPluginRuntimeStateForTests } from '../../../plugin-registry/pluginRuntimeState';

/** 只由进程验收显式选择；SIGKILL 不运行 finally，模拟 owner 提交后的真实 Backend 崩溃。 */
it.skipIf(!process.env.LINNYA_TEST_CRASH_DB)('crash after managed owner commit', async () => {
  const dbPath = process.env.LINNYA_TEST_CRASH_DB;
  const projectId = process.env.LINNYA_TEST_CRASH_PROJECT;
  if (!dbPath || !projectId) throw new Error('Crash fixture identities are required');
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
  class CrashAfterWrite extends WriteFileTool {
    override async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      await super.run(args, context);
      process.kill(process.pid, 'SIGKILL');
      throw new Error('SIGKILL must stop this process');
    }
  }
  const fixture = await createDurableFlowHarness(
    dbPath,
    [
      {
        toolCalls: [
          {
            id: 'killed-write',
            name: 'write_file',
            argumentsJson: JSON.stringify({
              locator: 'workspace:/killed.md',
              content: 'Committed before crash',
            }),
          },
        ],
      },
    ],
    [new CrashAfterWrite()]
  );
  await fixture.flow.next(
    {
      conversation_id: 'durable-conversation',
      project_id: projectId,
      new_events: [
        {
          type: 'user_input',
          content: 'Original request before crash',
          source: 'user',
          timestamp: 1,
        },
      ],
      options: {
        promptKey: 'default',
        model_id: 'scripted-test-model',
        project_metadata: { id: projectId, name: 'Recovery' },
      },
    },
    () => {}
  );
  throw new Error(`Crash boundary was not reached: ${JSON.stringify(fixture.getToolExecutions())}`);
});
