import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationAgentIds,
  PromptKeys,
  ResearchRunArgsSchema,
  type ConversationNextRequest,
} from '@app/schemas';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { BaseTool } from 'src/tools/types';
import { admitResearchRequest } from '../../../agent-registry/agents/research_v1/admission';
import { clearRegisteredAgentTaskCache } from '../../../agent-registry/agentTaskResolver';
import { requireRuntimeCompatibility } from '../../../application/run-resumption/functions/runtimeCompatibility';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import * as agentDefinitions from '../../../agent-registry/agentDefinitionResolver';
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
  options: { promptKey: PromptKeys.DEEP_RESEARCH_LEADER, model_id: 'scripted-test-model' },
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

describe('legacy research new-run admission', () => {
  it.each(['prompt-key', 'selected-agent'] as const)(
    '拒绝 %s 新请求，且不创建运行、消息或调用模型',
    async entry => {
      const fixture = await open([]);
      const incoming =
        entry === 'prompt-key'
          ? request
          : admitConversationAgentChoice({
              ...request,
              options: {
                selected_agent_id: ConversationAgentIds.DEEP_RESEARCH,
                model_id: 'scripted-test-model',
              },
            });
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

  it('新接纳限制不删除旧历史、不取消暂停运行，重开数据库后仍按原身份继续', async () => {
    // 只还原旧版接纳元数据来创建历史夹具；执行配置和恢复兼容性均使用正式旧 Leader。
    const findDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
    const beforeDisable = vi
      .spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey')
      .mockImplementation(key => {
        const definition = findDefinition(key);
        return key === PromptKeys.DEEP_RESEARCH_LEADER && definition
          ? { ...definition, newRunUnavailableReason: undefined }
          : definition;
      });
    const first = await open([
      { contentChunks: ['partial'], throwAfterEvents: new Error('network interrupted') },
    ]);
    await first.flow.next(request, () => {});
    beforeDisable.mockRestore();
    const original = await paused(first);
    const descriptor = await first.runtime.runDescriptors?.load(original.run_id);
    expect(descriptor?.request.promptKey).toBe(PromptKeys.DEEP_RESEARCH_LEADER);
    const history = readTail(first.db, conversationId, 100);
    expect(history.status).toBe('ready');
    const factsBefore = (await first.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(factsBefore.filter(event => event.type === 'user_input')).toHaveLength(1);
    first.close();
    closers.pop();
    resetAgentRuntimeSingletonsForTest();

    const restarted = await open([{ contentChunks: ['Original legacy run completed'] }]);
    expect(readTail(restarted.db, conversationId, 100)).toEqual(history);
    const restored = await paused(restarted);
    expect(restored.run_id).toBe(original.run_id);
    await expect(restarted.flow.next(request, () => {})).rejects.toMatchObject({
      code: 'AGENT_NEW_RUN_UNAVAILABLE',
    });
    expect((await paused(restarted)).run_id).toBe(original.run_id);
    expect((await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events).toEqual(
      factsBefore
    );
    expect(await restarted.runtime.runDescriptors?.load(original.run_id)).toEqual(descriptor);
    const run = vi.spyOn(restarted.runner, 'run');
    await restarted.flow.continueRun(
      restored.run_id,
      {
        conversation_id: conversationId,
        expected_updated_at: restored.pause.updated_at,
        expected_execution_id: restored.execution_id,
      },
      () => {}
    );
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].request.promptKey).toBe(PromptKeys.DEEP_RESEARCH_LEADER);
    const facts = (await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
    expect(
      facts.filter(event => event.type === 'final_answer').map(event => event.content)
    ).toEqual(['Original legacy run completed']);
    expect(facts.every(event => event.run_id === original.run_id)).toBe(true);
    expect(await restarted.flow.getActiveForegroundRun(conversationId)).toMatchObject({
      run: null,
    });
    restarted.ai.assertAllTurnsConsumed();
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
