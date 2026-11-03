// 先加载 Host 组合根，再读取具体工具，避开内置工具注册表已有的循环引用。
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { ConversationNextRequest } from '@app/schemas';
import { recordAfterContextManager, type AuditControlPort } from 'src/domains/audit';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { BaseTool } from 'src/tools/types';
import { SubagentTool } from 'src/tools/agent_control/subrun/subagent/subagentTool';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';

const conversationId = 'audit-policy-conversation';
const request: ConversationNextRequest = {
  conversation_id: conversationId,
  new_events: [{ type: 'user_input', content: 'Audit policy', source: 'user', timestamp: 1 }],
  options: { promptKey: 'default', model_id: 'scripted-test-model' },
};
let directory: string;
const fixtures: Awaited<ReturnType<typeof createDurableFlowHarness>>[] = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-audit-policy-'));
  vi.stubEnv('LINNYA_AUDIT_LEVEL', undefined);
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const fixture of fixtures.splice(0).reverse()) fixture.close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
async function open(turns: Parameters<typeof createDurableFlowHarness>[1], tools: BaseTool[] = []) {
  const fixture = await createDurableFlowHarness(
    join(directory, 'workspace.sqlite'),
    turns,
    tools,
    false
  );
  fixtures.push(fixture);
  return fixture;
}

describe('durable per-run audit policy', () => {
  it.each(['off', 'stream'] as const)(
    '运行中从 %s 切档，原 run 与之后生成的 child 保持原档位，新 run 使用新档位',
    async initial => {
      let control: AuditControlPort;
      const next = initial === 'off' ? 'stream' : 'off';
      class SwitchAudit extends BaseTool {
        readonly name = 'read_file';
        readonly description = 'Audit switch fixture';
        readonly parameters = { type: 'object' as const, properties: {}, required: [] };
        async run(): Promise<string> {
          control.setLevel(next);
          // 在切档之后产生证据，实际经过 ALS、AuditPort 和 SQLite，不能只断言 metadata。
          recordAfterContextManager({ llmMessages: [{ role: 'user', content: 'after-switch' }] });
          return 'Switched';
        }
      }
      const fixture = await open(
        [
          { toolCalls: [{ id: 'switch', name: 'read_file', argumentsJson: '{}' }] },
          {
            toolCalls: [
              {
                id: 'child',
                name: 'subagent',
                argumentsJson: JSON.stringify({ description: 'Inspect', prompt: 'Child' }),
              },
            ],
          },
          { contentChunks: ['Child completed'] },
          { contentChunks: ['Root completed'] },
          { contentChunks: ['New run completed'] },
        ],
        [new SwitchAudit(), new SubagentTool()]
      );
      control = fixture.runtime.audit;
      control.setLevel(initial);
      await fixture.flow.next(request, () => {});
      const firstRuns = await fixture.runtime.supervisor.findByConversation(conversationId, {
        includeChildren: true,
      });
      expect(firstRuns, JSON.stringify(firstRuns)).toHaveLength(2);
      expect(
        firstRuns.every(run => run.status === 'completed' && run.metadata?.auditLevel === initial)
      ).toBe(true);
      const root = firstRuns.find(run => !run.parentRunId);
      const child = firstRuns.find(run => run.parentRunId);
      if (!root || !child) throw new Error('Missing completed run tree');
      const evidence = (await fixture.runtime.eventStore.range(conversationId)).filter(
        row => row.event.type === 'audit_envelope'
      );
      if (initial === 'off') expect(evidence).toHaveLength(0);
      else {
        expect(
          evidence.some(
            row =>
              row.event.run_id === root.runId && JSON.stringify(row.event).includes('after-switch')
          )
        ).toBe(true);
        expect(
          evidence.some(
            row =>
              row.event.run_id === child.runId &&
              JSON.stringify(row.event).includes('llm.transcript')
          )
        ).toBe(true);
      }
      await fixture.flow.next(request, () => {});
      const all = await fixture.runtime.supervisor.findByConversation(conversationId, {
        includeChildren: true,
      });
      expect(all).toHaveLength(3);
      expect(
        all.find(run => !firstRuns.some(first => first.runId === run.runId))?.metadata?.auditLevel
      ).toBe(next);
      fixture.ai.assertAllTurnsConsumed();
    }
  );

  it('重启重置实例默认档位，暂停 run 的持久档位在继续执行时保留', async () => {
    const first = await open([{ throwAfterEvents: new Error('network interrupted') }]);
    first.runtime.audit.setLevel('response');
    await first.flow.next(request, () => {});
    const original = (await first.flow.getActiveForegroundRun(conversationId)).run;
    if (!original?.pause?.settled) throw new Error('Expected settled pause');
    expect(await first.runtime.audit.levelForRun(original.run_id)).toBe('response');
    first.close();
    fixtures.pop();
    resetAgentRuntimeSingletonsForTest();
    const restarted = await open([{ contentChunks: ['Resumed'] }]);
    expect(restarted.runtime.audit.level).toBe('off');
    const restored = (await restarted.flow.getActiveForegroundRun(conversationId)).run;
    if (!restored?.pause?.settled || !restored.execution_id)
      throw new Error('Expected restored pause');
    await restarted.flow.continueRun(
      restored.run_id,
      {
        conversation_id: conversationId,
        expected_updated_at: restored.pause.updated_at,
        expected_execution_id: restored.execution_id,
      },
      () => {}
    );
    const final = await restarted.runtime.supervisor.peek(RunIdSchema.parse(original.run_id));
    expect(final, JSON.stringify(final)).toMatchObject({ status: 'completed' });
    expect(await restarted.runtime.audit.levelForRun(original.run_id)).toBe('response');
    restarted.ai.assertAllTurnsConsumed();
  });
});
