import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationSelectedAgentIdSchema,
  RETIRED_DEEP_RESEARCH_AGENT_IDS,
  ResearchRunArgsSchema,
  type ConversationNextRequest,
} from '@app/schemas';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { BaseTool } from 'src/tools/types';
import { admitResearchRequest } from '../../../agent-registry/agents/research_v1/admission';
import { clearRegisteredAgentTaskCache } from '../../../agent-registry/agentTaskResolver';
import { requireRuntimeCompatibility } from '../../../application/run-resumption/functions/runtimeCompatibility';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import * as agentDefinitions from '../../../agent-registry/agentDefinitionResolver';
import * as newRunAdmission from '../../../agent-registry/assertAgentNewRunAvailable';
import { AskTool } from 'src/tools/agent_control/ask/AskTool';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { readTail } from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import { admitConversationAgentChoice } from '../functions/admitConversationAgentChoice';

const conversationId = 'legacy-research-conversation';
const request: ConversationNextRequest = {
  conversation_id: conversationId,
  new_events: [
    {
      type: 'user_input',
      content: 'Original legacy research question',
      source: 'user',
      timestamp: 1,
    },
  ],
  options: { promptKey: 'deep_research_leader', model_id: 'scripted-test-model' },
};
let directory: string;
const closers: Array<() => void> = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-legacy-research-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const close of closers.splice(0).reverse()) close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  clearRegisteredAgentTaskCache();
  rmSync(directory, { recursive: true, force: true });
});
async function open(
  turns: Parameters<typeof createDurableFlowHarness>[1],
  tools: Parameters<typeof createDurableFlowHarness>[2] = []
) {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns, tools);
  closers.push(fixture.close);
  return fixture;
}
async function paused(fixture: Awaited<ReturnType<typeof open>>) {
  const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!active || active.status !== 'paused' || !active.pause?.settled || !active.execution_id) {
    throw new Error(`Expected original settled pause: ${JSON.stringify(active)}`);
  }
  return { ...active, pause: active.pause, execution_id: active.execution_id };
}

/**
 * 旧版深度研究的定义已删除。为制造“升级前留下的暂停运行”，首次运行临时用 Default 定义冒充
 * 原退役身份并跳过新运行接纳；重开数据库后恢复真实注册表，验证退役终止合同。
 */
function impersonateRetiredDefinition(promptKey: string) {
  const findDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
  const definitions = vi
    .spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey')
    .mockImplementation(key => {
      if (key !== promptKey) return findDefinition(key);
      const standIn = findDefinition('default');
      return standIn && { ...standIn, id: promptKey, promptKey };
    });
  const admission = vi
    .spyOn(newRunAdmission, 'assertAgentNewRunAvailable')
    .mockImplementation(() => undefined);
  clearRegisteredAgentTaskCache();
  return () => {
    definitions.mockRestore();
    admission.mockRestore();
    clearRegisteredAgentTaskCache();
  };
}

async function reopenWithoutRetiredDefinition(
  first: Awaited<ReturnType<typeof open>>,
  restore: () => void,
  tools: Parameters<typeof createDurableFlowHarness>[2] = []
) {
  first.close();
  closers.pop();
  resetAgentRuntimeSingletonsForTest();
  restore();
  return open([], tools);
}

describe('retired legacy research termination', () => {
  it.each([...RETIRED_DEEP_RESEARCH_AGENT_IDS, 'selected-agent'] as const)(
    '拒绝 %s 新请求，且不创建运行、消息或调用模型',
    async entry => {
      const fixture = await open([]);
      const incoming =
        entry === 'selected-agent'
          ? admitConversationAgentChoice({
              ...request,
              options: {
                selected_agent_id: ConversationSelectedAgentIdSchema.parse('deep_research_leader'),
                model_id: 'scripted-test-model',
              },
            })
          : { ...request, options: { ...request.options, promptKey: entry } };
      await expect(fixture.flow.next(incoming, () => {})).rejects.toMatchObject({
        code: 'AGENT_NEW_RUN_UNAVAILABLE',
      });
      expect(await fixture.runtime.supervisor.findByConversation(conversationId)).toEqual([]);
      expect((await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events).toEqual(
        []
      );
      expect(fixture.ai.getConsumedTurnCount()).toBe(0);
    }
  );

  it.each(['deep_research_leader', 'deep_research_experimental'])(
    '%s 暂停运行重开后仍可查看，继续时明确终止并报告，不切换到其它 Agent',
    async promptKey => {
      const originalRequest = { ...request, options: { ...request.options, promptKey } };
      const restore = impersonateRetiredDefinition(promptKey);
      const first = await open([
        { contentChunks: ['partial'], throwAfterEvents: new Error('network interrupted') },
      ]);
      await first.flow.next(originalRequest, () => {});
      const original = await paused(first);
      const factsBefore = (await first.eventStore.readEvents(conversationId, { limit: 100 }))
        .events;
      expect(factsBefore.filter(event => event.type === 'user_input')).toHaveLength(1);

      const restarted = await reopenWithoutRetiredDefinition(first, restore);
      expect(readTail(restarted.db, conversationId, 100).status).toBe('ready');
      const restored = await paused(restarted);
      expect(restored.run_id).toBe(original.run_id);
      await expect(restarted.flow.next(originalRequest, () => {})).rejects.toMatchObject({
        code: 'AGENT_NEW_RUN_UNAVAILABLE',
      });
      expect((await paused(restarted)).run_id).toBe(original.run_id);

      const run = vi.spyOn(restarted.runner, 'run');
      await expect(
        restarted.flow.continueRun(
          restored.run_id,
          {
            conversation_id: conversationId,
            expected_updated_at: restored.pause.updated_at,
            expected_execution_id: restored.execution_id,
          },
          () => {}
        )
      ).rejects.toMatchObject({ code: 'AGENT_RETIRED' });
      expect(run).not.toHaveBeenCalled();
      expect(restarted.ai.getConsumedTurnCount()).toBe(0);
      expect(await restarted.flow.getActiveForegroundRun(conversationId)).toMatchObject({
        run: null,
      });
      expect(
        (await restarted.runtime.supervisor.peek(RunIdSchema.parse(original.run_id)))?.status
      ).toBe('cancelled');
      const facts = (await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events;
      expect(facts).toEqual(expect.arrayContaining(factsBefore));
      expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
      expect(facts.some(event => event.type === 'final_answer')).toBe(false);
      expect(readTail(restarted.db, conversationId, 100).status).toBe('ready');
    }
  );

  it('待审批的旧版深度研究运行在响应时明确终止，不执行原工具或模型', async () => {
    const promptKey = 'deep_research_leader';
    const restore = impersonateRetiredDefinition(promptKey);
    const first = await open(
      [
        {
          toolCalls: [
            {
              id: 'retired-ask',
              name: 'ask',
              argumentsJson: JSON.stringify({
                questions: [{ id: 'answer', type: 'text', question: 'Which scope?' }],
              }),
            },
          ],
        },
      ],
      [new AskTool()]
    );
    await first.flow.next({ ...request, options: { ...request.options, promptKey } }, () => {});
    const waiting = (await first.flow.getActiveForegroundRun(conversationId)).run;
    if (waiting?.status !== 'awaiting_user' || !waiting.pending_interaction) {
      throw new Error(`Expected original approval: ${JSON.stringify(waiting)}`);
    }
    const pending = waiting.pending_interaction;
    const restarted = await reopenWithoutRetiredDefinition(first, restore, [new AskTool()]);
    await expect(
      restarted.flow.respondInteraction(
        {
          conversation_id: conversationId,
          run_id: waiting.run_id,
          interaction_id: pending.interaction_id,
          resume_token: pending.resume_token,
          checkpoint_revision: pending.checkpoint_revision,
          tool_call_id: pending.tool_call_id,
          tool_name: 'ask',
          observation: 'Use the original scope',
          data: {},
          interaction_status: 'submitted',
          interaction_submitted_at: Date.now(),
        },
        () => {}
      )
    ).rejects.toMatchObject({ code: 'AGENT_RETIRED' });
    expect(restarted.ai.getConsumedTurnCount()).toBe(0);
    expect(await restarted.flow.getActiveForegroundRun(conversationId)).toMatchObject({
      run: null,
    });
    const facts = (await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
    expect(facts.some(event => event.type === 'tool_output')).toBe(false);
  });

  it.each(['host', 'delegated'] as const)(
    '%s 旧交接协议在重启后明确拒绝续跑，保留原身份、历史和暂停资源',
    async kind => {
      const scope = ResearchRunArgsSchema.parse({
        question: 'Original scoped question',
        reader: 'Original reader',
        task_type: 'open',
        materials: [],
      });
      class LegacyResearchTool extends BaseTool {
        readonly name = 'research_run';
        readonly description = 'Retired research recovery fixture';
        readonly parameters = { type: 'object' as const, properties: {}, required: [] };
        async run(): Promise<string> {
          throw new graph.RunRecoveryBlockedError('Interrupted legacy handoff');
        }
      }
      const findDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
      const definitions = vi
        .spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey')
        .mockImplementation(key => {
          const definition = findDefinition(key);
          return key === 'research_v1' && definition
            ? {
                ...definition,
                requestAdmission: kind === 'host' ? undefined : admitResearchRequest,
                config: {
                  availableTools:
                    kind === 'host'
                      ? []
                      : ['subagent', 'submit_research_document', 'complete_research'],
                  enableTools: kind !== 'host',
                  modelPolicy: { kind: 'user_primary' },
                },
                hostEntry:
                  kind === 'host'
                    ? { toolName: 'research_run', resolveArgs: () => scope }
                    : undefined,
                task: { systemPromptBuilder: () => 'Original frozen research contract' },
              }
            : definition;
        });
      clearRegisteredAgentTaskCache();
      const first = await open(
        kind === 'host'
          ? []
          : [
              {
                contentChunks: ['Investigating'],
                throwAfterEvents: new Error('network interrupted'),
              },
            ],
        kind === 'host' ? [new LegacyResearchTool()] : []
      );
      await first.flow.next(
        {
          ...request,
          options: {
            promptKey: 'research_v1',
            model_id: 'scripted-test-model',
            project_metadata: { id: 'project' },
            ...(kind === 'host'
              ? {
                  host_tool_call: {
                    tool_name: 'research_run',
                    args: scope,
                    completion_mode: 'yield_after_batch' as const,
                  },
                }
              : {}),
          },
        },
        () => {}
      );
      const original = await paused(first);
      const descriptor = await first.runtime.runDescriptors?.load(original.run_id);
      if (!descriptor) throw new Error('Missing historical descriptor');
      const history = readTail(first.db, conversationId, 100);
      const events = (await first.eventStore.readEvents(conversationId, { limit: 100 })).events;
      first.close();
      closers.pop();
      resetAgentRuntimeSingletonsForTest();
      definitions.mockRestore();
      clearRegisteredAgentTaskCache();

      const restarted = await open([]);
      const restored = await paused(restarted);
      expect(restored.run_id).toBe(original.run_id);
      expect(() => requireRuntimeCompatibility(descriptor)).toThrow(
        'Original run capabilities changed'
      );
      await expect(
        restarted.flow.continueRun(
          restored.run_id,
          {
            conversation_id: conversationId,
            expected_updated_at: restored.pause.updated_at,
            expected_execution_id: restored.execution_id,
          },
          () => {}
        )
      ).rejects.toThrow('Original run capabilities changed');
      expect(restarted.ai.getConsumedTurnCount()).toBe(0);
      expect(readTail(restarted.db, conversationId, 100)).toEqual(history);
      expect(
        (await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events
      ).toEqual(events);
      expect(await restarted.runtime.runDescriptors?.load(original.run_id)).toEqual(descriptor);
      expect((await paused(restarted)).run_id).toBe(original.run_id);
    }
  );
});
