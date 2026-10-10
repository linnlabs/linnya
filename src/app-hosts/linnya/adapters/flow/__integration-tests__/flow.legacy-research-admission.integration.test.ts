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
import { modelCatalog } from 'src/domains/model-catalog';
import { admitResearchRequest } from '../../../agent-registry/agents/research_v1/admission';
import { LEGACY_RESEARCH_DELEGATED_AUTHOR_CONFIGURATION } from '../../../agent-registry/agents/research_v1/legacyCompatibility';
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

  it('父 Agent 改为直接成文后，旧委派作者根保留冻结角色和提示重启继续，未知配置仍拒绝', async () => {
    const findDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
    const definitions = vi
      .spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey')
      .mockImplementation(key => {
        const definition = findDefinition(key);
        return key === 'research_v1' && definition
          ? {
              ...definition,
              config: LEGACY_RESEARCH_DELEGATED_AUTHOR_CONFIGURATION,
              task: { systemPromptBuilder: () => 'Original delegated-author research prompt' },
            }
          : definition;
      });
    clearRegisteredAgentTaskCache();
    const first = await open([
      { contentChunks: ['Investigating'], throwAfterEvents: new Error('network interrupted') },
    ]);
    await first.flow.next(
      {
        ...request,
        options: {
          promptKey: 'research_v1',
          model_id: 'scripted-test-model',
          project_metadata: { id: 'project' },
        },
      },
      () => {}
    );
    const original = await paused(first);
    const descriptor = await first.runtime.runDescriptors?.load(original.run_id);
    if (!descriptor) throw new Error('Missing delegated-author descriptor');
    expect(descriptor.request.availableSubagentTypes).toContain('research_draft');
    expect(descriptor.request.availableSubagentTypes).toContain('research_revision');
    expect(descriptor.request.frozenSystemPrompt).toContain(
      'Original delegated-author research prompt'
    );
    first.close();
    closers.pop();
    resetAgentRuntimeSingletonsForTest();
    definitions.mockImplementation(key => {
      const definition = findDefinition(key);
      return key === 'research_v1' && definition
        ? {
            ...definition,
            task: {
              systemPromptBuilder: () => {
                throw new Error('Must keep the old frozen prompt');
              },
            },
          }
        : definition;
    });
    clearRegisteredAgentTaskCache();
    const restarted = await open([{ contentChunks: ['Original research remains unfinished'] }]);
    const restored = await paused(restarted);
    expect(restored.run_id).toBe(original.run_id);
    expect(() => requireRuntimeCompatibility(descriptor)).not.toThrow();
    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        compatibility: {
          ...descriptor.compatibility,
          agentConfiguration: {
            ...descriptor.compatibility.agentConfiguration,
            availableTools: [
              ...(LEGACY_RESEARCH_DELEGATED_AUTHOR_CONFIGURATION.availableTools ?? []),
              'write_file',
            ],
          },
        },
      })
    ).toThrow('Original run capabilities changed');
    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        child: {
          parentRunId: descriptor.runId,
          parentToolCallId: 'other-call',
          subrunId: 'other-child',
        },
      })
    ).toThrow('Original run capabilities changed');
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
    expect(run.mock.calls[0]?.[0].request.availableSubagentTypes).toEqual(
      descriptor.request.availableSubagentTypes
    );
    expect(run.mock.calls[0]?.[0].request.frozenSystemPrompt).toEqual(
      descriptor.request.frozenSystemPrompt
    );
    const facts = (await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
    expect(
      facts.filter(event => event.type === 'final_answer').map(event => event.content)
    ).toEqual(['Original research remains unfinished']);
    expect(facts.every(event => event.run_id === original.run_id)).toBe(true);
    restarted.ai.assertAllTurnsConsumed();
  });

  it('旧 research_run descriptor 重启后保留原 scope、提示及运行身份，不重走新研究接纳', async () => {
    const scope = ResearchRunArgsSchema.parse({
      question: 'Original scoped question',
      reader: 'Original reader',
      task_type: 'open',
      materials: [],
    });
    const legacyRequest: ConversationNextRequest = {
      ...request,
      options: {
        promptKey: 'research_v1',
        model_id: 'scripted-test-model',
        project_metadata: { id: 'project' },
        host_tool_call: {
          tool_name: 'research_run',
          args: scope,
          completion_mode: 'yield_after_batch',
        },
      },
    };
    class LegacyResearchTool extends BaseTool {
      readonly name = 'research_run';
      readonly description = 'Legacy research recovery fixture';
      readonly parameters = { type: 'object' as const, properties: {}, required: [] };
      async run(): Promise<string> {
        throw new graph.RunRecoveryBlockedError('Interrupted legacy stage handoff');
      }
    }
    const findDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
    // 仅构造旧版本已接纳事实；恢复使用当前 definition 与正式 durable continuation。
    const definitions = vi
      .spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey')
      .mockImplementation(key => {
        const definition = findDefinition(key);
        return key === 'research_v1' && definition
          ? {
              ...definition,
              requestAdmission: undefined,
              config: {
                availableTools: [],
                enableTools: false,
                modelPolicy: { kind: 'user_primary' },
              },
              hostEntry: { toolName: 'research_run', resolveArgs: () => scope },
              task: { systemPromptBuilder: () => 'Original frozen research Host entry' },
            }
          : definition;
      });
    clearRegisteredAgentTaskCache();
    const first = await open([], [new LegacyResearchTool()]);
    await first.flow.next(legacyRequest, () => {});
    const original = await paused(first);
    const descriptor = await first.runtime.runDescriptors?.load(original.run_id);
    expect(descriptor?.request.researchScope).toBeUndefined();
    expect(descriptor?.request.frozenSystemPrompt).toContain('Original frozen research Host entry');
    expect(descriptor?.options?.host_tool_call).toEqual(legacyRequest.options?.host_tool_call);
    first.close();
    closers.pop();
    resetAgentRuntimeSingletonsForTest();
    // 新入口必须拒绝同一 Host 请求；若恢复错误地重建 prompt，也明确使本测试失败。
    definitions.mockImplementation(key => {
      const definition = findDefinition(key);
      return key === 'research_v1' && definition
        ? {
            ...definition,
            hostEntry: undefined,
            requestAdmission: admitResearchRequest,
            task: {
              systemPromptBuilder: () => {
                throw new Error('Must reuse the original frozen prompt');
              },
            },
          }
        : definition;
    });
    clearRegisteredAgentTaskCache();
    const tool = new LegacyResearchTool();
    const execute = vi.spyOn(tool, 'run').mockResolvedValue(
      JSON.stringify({
        data: {
          status: 'inputs_changed',
          model_id: 'scripted-test-model',
          subrun_ids: [],
          artifacts: [],
          changed_paths: ['workspace:/source.md'],
        },
        observation: 'Original research stopped because its source changed',
      })
    );
    const restarted = await open([], [tool]);
    const restored = await paused(restarted);
    await expect(restarted.flow.next(legacyRequest, () => {})).rejects.toMatchObject({
      code: 'RESEARCH_HOST_ENTRY_NOT_SUPPORTED',
    });
    expect(await restarted.runtime.runDescriptors?.load(original.run_id)).toEqual(descriptor);
    if (!descriptor) throw new Error('Missing legacy descriptor');
    // 这份兼容配置只允许已声明的旧 Host 身份，不宽放任意旧配置或其它环境变化。
    expect(() => requireRuntimeCompatibility(descriptor)).not.toThrow();
    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        compatibility: {
          ...descriptor.compatibility,
          agentConfiguration: { ...descriptor.compatibility.agentConfiguration, enableTools: true },
        },
      })
    ).toThrow('Original run capabilities changed');
    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        request: { ...descriptor.request, promptKey: 'default' },
      })
    ).toThrow('Original run capabilities changed');
    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        options: { ...descriptor.options, host_tool_call: undefined },
      })
    ).toThrow('Original run capabilities changed');
    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        compatibility: {
          ...descriptor.compatibility,
          frameworkVersion: 'unavailable-original-version',
        },
      })
    ).toThrow('Original run capabilities changed');

    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        child: {
          parentRunId: descriptor.runId,
          parentToolCallId: 'parent-call',
          subrunId: 'child',
        },
      })
    ).toThrow('Original run capabilities changed');
    expect(() =>
      requireRuntimeCompatibility({
        ...descriptor,
        options: {
          ...descriptor.options,
          host_tool_call: {
            tool_name: 'research_run',
            args: scope,
            completion_mode: 'continue_to_llm',
          },
        },
      })
    ).toThrow('Original run capabilities changed');
    vi.mocked(modelCatalog.getModel).mockReturnValueOnce(undefined);
    expect(() => requireRuntimeCompatibility(descriptor)).toThrow('Run model unavailable');
    await restarted.flow.continueRun(
      restored.run_id,
      {
        conversation_id: conversationId,
        expected_updated_at: restored.pause.updated_at,
        expected_execution_id: restored.execution_id,
      },
      () => {}
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(restarted.getToolExecutions()[0]?.args).toEqual(scope);
    const facts = (await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
    expect(facts.filter(event => event.type === 'tool_output')).toMatchObject([
      { tool_name: 'research_run', status: 'success' },
    ]);
    expect(facts.every(event => event.run_id === original.run_id)).toBe(true);
    expect((await restarted.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    expect(restarted.ai.getConsumedTurnCount()).toBe(0);
  });
});
