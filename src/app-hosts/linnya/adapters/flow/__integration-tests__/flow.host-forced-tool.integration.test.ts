import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/utils/pathManager', () => {
  const stubPath = 'D:/code/Tingtalk_official_version/_test_data';
  const pathManager = {
    getAppDataPath: vi.fn(() => stubPath),
    getWorkspaceRoot: vi.fn(() => stubPath),
    getWorkspaceDataPath: vi.fn(() => stubPath),
    getKbDataPath: vi.fn(() => stubPath),
    getUploadsPath: vi.fn(() => stubPath),
    getTempDirectory: vi.fn(() => stubPath),
    getSourceOfTruthPath: vi.fn(() => stubPath),
    getLogDirectory: vi.fn(() => stubPath),
    getProjectRoot: vi.fn(() => 'D:/code/Tingtalk_official_version'),
    setWorkspaceRoot: vi.fn(() => stubPath),
    getConversationEvidenceBundlesDir: vi.fn(() => stubPath),
    getConversationCitationSnapshotBundlesDir: vi.fn(() => stubPath),
    getConversationToolOutputBlobsDir: vi.fn(() => stubPath),
    getConversationToolOutputBlobsPath: vi.fn(() => stubPath),
    getConversationEvidenceBundleFilePath: vi.fn(() => `${stubPath}/evidence.json`),
    getConversationCitationSnapshotBundleFilePath: vi.fn(() => `${stubPath}/citation.json`),
    getConversationToolOutputBlobDirPath: vi.fn(
      (params: { blobId: string }) => `${stubPath}/${params.blobId}`,
    ),
    getConversationInstanceNamespaceDir: vi.fn(() => stubPath),
    getSkillsPath: vi.fn(() => `${stubPath}/skills`),
  };

  return {
    pathManager,
    ...pathManager,
    getAudioRecordingsPath: vi.fn(() => stubPath),
  };
});

import type { ConversationNextRequest } from '@app/schemas';
import type {
  FinalAnswerEvent,
  RuntimeEvent,
  ToolCallDecisionEvent,
  ToolOutputEvent,
} from '@linnlabs/linnkit/contracts';
import {
  createScriptedInferenceHarness,
  type ScriptedInferenceHarness,
} from '@linnlabs/linnkit/testkit';
import { AgentRunnerService } from 'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { createAgentRunnerRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/agentRunnerRuntimeHarness';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import { FlowOrchestrator } from 'src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import type { ConversationRealtimeEvent } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { FlowIncomingEventPreparer } from 'src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import { createDirectFlowConversationAdmissionPort } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDirectFlowConversationAdmissionPort';
import {
  buildFlowIntegrationEngine,
  createFlowIntegrationRuntimePersistence,
  InMemoryFlowEventStore,
} from 'src/app-hosts/linnya/testkit/agent-harness/flowIntegrationHarness';
import {
  createToolRuntimeHarness,
  type ToolRuntimeHarness,
} from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import { SubrunBatchTool } from 'src/tools/agent_control/subrun/batch';
import { WriteToTableTool } from 'src/domains/markdown/tools';
import * as subagentRunner from 'src/tools/agent_control/subrun/shared';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import type { CanonicalInferenceMessage } from '@linnlabs/linnkit/ports';

class HostOnlyProbeTool extends BaseTool {
  readonly name = 'host_only_probe';
  readonly description = '仅由 host 指定执行的集成测试工具。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      unit_ids: {
        type: 'array',
        items: { type: 'string', description: '单元 ID。' },
        description: '待处理单元。',
      },
    },
    required: ['unit_ids'],
  };
  readonly invocations: string[][] = [];

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const unitIds = Array.isArray(args.unit_ids)
      ? args.unit_ids.filter((value): value is string => typeof value === 'string')
      : [];
    this.invocations.push(unitIds);
    return JSON.stringify({
      observation: `系统批次已处理 ${unitIds.length} 个单元。`,
      data: { unit_ids: unitIds },
    });
  }
}

class HostOnlyBlockingTool extends BaseTool {
  readonly name = 'host_only_blocking_probe';
  readonly description = '用于验证 host forced-tool 取消链路。';
  readonly parameters: ToolParameterSchema = { type: 'object', properties: {} };
  readonly started: Promise<void>;
  private markStarted: (() => void) | undefined;

  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  async run(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
    this.markStarted?.();
    this.markStarted = undefined;
    const signal = context.abortSignal;
    if (!signal) {
      throw new Error('host forced-tool 必须继承 run 的取消信号');
    }

    await new Promise<void>((_resolve, reject) => {
      const rejectAsAborted = () => {
        const error = new Error('The user aborted a request.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) {
        rejectAsAborted();
        return;
      }
      signal.addEventListener('abort', rejectAsAborted, { once: true });
    });
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readActivityBinding(event: unknown): unknown {
  if (!isRecord(event) || !isRecord(event['metadata'])) return undefined;
  return event['metadata']['activity'];
}

function messageText(message: CanonicalInferenceMessage): string {
  if (message.role === 'system') return message.content;
  if (message.role === 'assistant') {
    return message.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('');
  }
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
}

function findMessageIndex(
  messages: readonly CanonicalInferenceMessage[],
  predicate: (message: CanonicalInferenceMessage) => boolean
): number {
  return messages.findIndex(predicate);
}

function isToolCallDecisionEvent(event: RuntimeEvent): event is ToolCallDecisionEvent {
  return event.type === 'tool_call_decision';
}

function isToolOutputEvent(event: RuntimeEvent): event is ToolOutputEvent {
  return event.type === 'tool_output';
}

function isFinalAnswerEvent(event: RuntimeEvent): event is FinalAnswerEvent {
  return event.type === 'final_answer';
}

async function createHostToolFlow(tool: BaseTool, aiHarness: ScriptedInferenceHarness) {
  const eventStore = new InMemoryFlowEventStore();
  const historyRepository = new HistoryRepository(eventStore);
  const historyHandler = new HistoryHandlerService(createFlowHistoryAccessPort(historyRepository));
  const persistenceCoordinator = new EventPersistenceCoordinator({
    persistencePort: createConversationPersistencePort(historyRepository),
    conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
  });
  const toolHarness = createToolRuntimeHarness([tool]);
  const engine = await buildFlowIntegrationEngine({
    llmCaller: aiHarness.getLlmCaller(),
    toolRuntime: toolHarness.toolRuntime,
  });
  const runtimePersistence = createFlowIntegrationRuntimePersistence(eventStore);
  const runner = new AgentRunnerService(
    engine,
    { searchDocuments: vi.fn().mockResolvedValue([]) } as unknown as import('src/features/knowledge-base/application/knowledgeBaseService').KnowledgeBaseService,
    { getDb: vi.fn() } as unknown as import('src/electron-main/services/database').DatabaseService,
    createAgentRunnerRuntimeHarness({ costCollector: runtimePersistence.costCollector }),
  );
  return {
    historyRepository,
    runtimePersistence,
    orchestrator: new FlowOrchestrator(
      historyHandler,
      runner,
      persistenceCoordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      runtimePersistence,
    ),
    toolHarness,
  };
}

async function readPersistedRuntimeEvents(
  runtimePersistence: ReturnType<typeof createFlowIntegrationRuntimePersistence>,
  conversationId: string,
): Promise<RuntimeEvent[]> {
  const persisted = await runtimePersistence.eventStore.range(conversationId);
  return persisted.map(({ event }) => event);
}

describe('Flow host forced-tool integration', () => {
  let aiHarness: ScriptedInferenceHarness | undefined;
  let toolHarness: ToolRuntimeHarness | undefined;

  afterEach(() => {
    toolHarness?.restore();
    aiHarness = undefined;
    toolHarness = undefined;
    resetAgentRuntimeSingletonsForTest();
    vi.restoreAllMocks();
  });

  it('host 指定工具后应直接执行并回到 default agent 自然收尾', async () => {
    const conversationId = 'conv_host_forced_tool';
    const hostOnlyTool = new HostOnlyProbeTool();
    aiHarness = createScriptedInferenceHarness([{
      contentChunks: ['系统批次已经处理完成。'],
      assertCall: (call) => {
        const userIndex = findMessageIndex(call.messages, (message) => (
          message.role === 'user'
          && messageText(message).includes('为这次系统批次生成简短结果。')
        ));
        const assistantToolCallIndex = findMessageIndex(call.messages, (message) => {
          return message.role === 'assistant'
            && message.parts.some(
              part => part.type === 'tool_call' && part.call.name === 'host_only_probe'
            );
        });
        const toolIndex = findMessageIndex(call.messages, (message) => message.role === 'tool');
        const exposesHostOnlyTool = (Array.isArray(call.options.tools) ? call.options.tools : [])
          .some(tool => tool.name === 'host_only_probe');

        expect(userIndex).toBeGreaterThanOrEqual(0);
        expect(assistantToolCallIndex).toBeGreaterThan(userIndex);
        expect(toolIndex).toBeGreaterThan(assistantToolCallIndex);
        expect(toolIndex).toBe(call.messages.length - 1);
        expect(exposesHostOnlyTool).toBe(false);
      },
    }]);
    const flow = await createHostToolFlow(hostOnlyTool, aiHarness);
    toolHarness = flow.toolHarness;

    const request: ConversationNextRequest = {
      conversation_id: conversationId,
      new_events: [{
        type: 'user_input',
        content: '为这次系统批次生成简短结果。',
        timestamp: Date.now(),
        source: 'system',
      }],
      options: {
        promptKey: 'default',
        model_id: 'scripted-test-model',
        host_tool_call: {
          tool_name: 'host_only_probe',
          args: { unit_ids: ['row-1', 'row-2', 'row-3'] },
        },
      },
    };

    await flow.orchestrator.next(request, () => {});

    expect(hostOnlyTool.invocations).toEqual([['row-1', 'row-2', 'row-3']]);
    const persistedEvents = await readPersistedRuntimeEvents(flow.runtimePersistence, conversationId);
    const decisions = persistedEvents.filter((event): event is ToolCallDecisionEvent => (
      isToolCallDecisionEvent(event) && event.tool_name === 'host_only_probe'
    ));
    const outputs = persistedEvents.filter((event): event is ToolOutputEvent => (
      isToolOutputEvent(event) && event.tool_name === 'host_only_probe'
    ));
    const finalAnswers = persistedEvents.filter((event): event is FinalAnswerEvent => (
      isFinalAnswerEvent(event) && event.content === '系统批次已经处理完成。'
    ));

    expect(decisions).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].tool_call_id).toBe(decisions[0].tool_call_id);
    expect(finalAnswers).toHaveLength(1);
    expect(persistedEvents.indexOf(decisions[0])).toBeLessThan(persistedEvents.indexOf(outputs[0]));
    expect(persistedEvents.indexOf(outputs[0])).toBeLessThan(persistedEvents.indexOf(finalAnswers[0]));
    aiHarness.assertAllTurnsConsumed();
  });

  it('正式 subrun_batch 应形成单一工具对，并由 default agent 生成一条 final_answer', async () => {
    const conversationId = 'conv_host_subrun_batch';
    const liveEvents: ConversationRealtimeEvent[] = [];
    const runChildren = vi.spyOn(subagentRunner, 'runRegisteredSubagentsInParallel').mockImplementation(async (params) => {
      const parentToolCallId = params.context.parentToolCallId;
      const createPublisher = params.context.createSubRunTracePublisher;
      if (!parentToolCallId || typeof createPublisher !== 'function') {
        throw new Error('subrun_batch 集成测试缺少 subrun trace 发布上下文');
      }

      expect(liveEvents.some((event) => (
        event.type === 'tool_call_decision'
        && event.tool_name === 'subrun_batch'
        && event.status === 'loading'
      ))).toBe(true);

      for (const subrunId of ['subrun-row-1', 'subrun-row-2']) {
        createPublisher({
          parentToolCallId,
          subrunId,
          source: 'subrun_batch',
        }).publish({
          kind: 'thought_delta',
          source_event_id: `${subrunId}-thought-1`,
          delta: `${subrunId} 正在执行`,
        });
      }

      return [
        {
          subrunId: 'subrun-row-1',
          success: true,
          finalAnswer: '第一行完成',
          events: [],
          stepCount: 1,
        },
        {
          subrunId: 'subrun-row-2',
          success: true,
          finalAnswer: '第二行完成',
          events: [],
          stepCount: 1,
        },
      ];
    });
    aiHarness = createScriptedInferenceHarness([{
      contentChunks: ['两行批量填充均已完成。'],
      assertCall: (call) => {
        const subrunBatchCallIndex = findMessageIndex(call.messages, (message) => {
          return message.role === 'assistant'
            && message.parts.some(
              part => part.type === 'tool_call' && part.call.name === 'subrun_batch'
            );
        });
        const toolResultIndex = findMessageIndex(call.messages, (message) => (
          message.role === 'tool'
          && messageText(message).includes('批量子任务完成：2/2 成功')
        ));
        const exposesSubrunBatch = (Array.isArray(call.options.tools) ? call.options.tools : [])
          .some(tool => tool.name === 'subrun_batch');

        expect(subrunBatchCallIndex).toBeGreaterThanOrEqual(0);
        expect(toolResultIndex).toBeGreaterThan(subrunBatchCallIndex);
        expect(exposesSubrunBatch).toBe(false);
      },
    }]);
    const flow = await createHostToolFlow(new SubrunBatchTool(), aiHarness);
    toolHarness = flow.toolHarness;

    await flow.orchestrator.next({
      conversation_id: conversationId,
      new_events: [{
        type: 'user_input',
        content: '完成这次表格批量填充并总结结果。',
        timestamp: Date.now(),
        source: 'system',
      }],
      options: {
        promptKey: 'default',
        model_id: 'scripted-test-model',
        activity: { runId: 'table-fill-run-1', feature: 'table_fill' },
        history_mode: 'isolated',
        host_tool_call: {
          tool_name: 'subrun_batch',
          args: {
            worker_prompt_key: 'table_ai_fill',
            subruns: [
              {
                unit_id: 'row-1',
                subrun_id: 'subrun-row-1',
                description: '填充第 1 行',
                prompt: '处理第一行。',
              },
              {
                unit_id: 'row-2',
                subrun_id: 'subrun-row-2',
                description: '填充第 2 行',
                prompt: '处理第二行。',
              },
            ],
          },
        },
      },
    }, (event) => {
      liveEvents.push(event);
    });

    expect(runChildren).toHaveBeenCalledWith(expect.objectContaining({
      maxConcurrency: 3,
      subruns: [
        expect.objectContaining({ promptKey: 'table_ai_fill', modelId: 'scripted-test-model' }),
        expect.objectContaining({ promptKey: 'table_ai_fill', modelId: 'scripted-test-model' }),
      ],
    }));
    const decisionIndex = liveEvents.findIndex((event) => (
      event.type === 'tool_call_decision' && event.tool_name === 'subrun_batch'
    ));
    const outputIndex = liveEvents.findIndex((event) => (
      event.type === 'tool_output' && event.tool_name === 'subrun_batch'
    ));
    const traceEvents = liveEvents.filter((event) => event.type === 'subrun_trace');
    expect(decisionIndex).toBeGreaterThanOrEqual(0);
    expect(outputIndex).toBeGreaterThan(decisionIndex);
    expect(traceEvents.map((event) => event.type === 'subrun_trace' ? event.subrun_id : '')).toEqual([
      'subrun-row-1',
      'subrun-row-2',
    ]);
    for (const traceEvent of traceEvents) {
      const traceIndex = liveEvents.indexOf(traceEvent);
      expect(traceIndex).toBeGreaterThan(decisionIndex);
      expect(traceIndex).toBeLessThan(outputIndex);
    }
    const persistedEvents = await readPersistedRuntimeEvents(flow.runtimePersistence, conversationId);
    const decisions = persistedEvents.filter((event): event is ToolCallDecisionEvent => (
      isToolCallDecisionEvent(event) && event.tool_name === 'subrun_batch'
    ));
    const outputs = persistedEvents.filter((event): event is ToolOutputEvent => (
      isToolOutputEvent(event) && event.tool_name === 'subrun_batch'
    ));
    const finalAnswers = persistedEvents.filter((event): event is FinalAnswerEvent => (
      isFinalAnswerEvent(event) && event.content === '两行批量填充均已完成。'
    ));

    expect(decisions).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.tool_call_id).toBe(decisions[0]?.tool_call_id);
    expect(finalAnswers).toHaveLength(1);
    const persistedInput = await flow.historyRepository.readFrom(conversationId, 0);
    const userInputs = persistedInput.events.filter((event) => event.type === 'user_input');
    expect(userInputs).toHaveLength(1);
    const activity = { runId: 'table-fill-run-1', feature: 'table_fill' };
    expect([
      readActivityBinding(userInputs[0]),
      readActivityBinding(decisions[0]),
      readActivityBinding(outputs[0]),
      readActivityBinding(finalAnswers[0]),
    ]).toEqual([activity, activity, activity, activity]);
    expect(persistedEvents.indexOf(outputs[0])).toBeLessThan(persistedEvents.indexOf(finalAnswers[0]));
    aiHarness.assertAllTurnsConsumed();
  });

  it('write_to_table 作为终局工具应在一次写入后结束当前 run', async () => {
    const conversationId = 'conv_host_write_to_table_terminal';
    aiHarness = createScriptedInferenceHarness([]);
    const flow = await createHostToolFlow(new WriteToTableTool(), aiHarness);
    toolHarness = flow.toolHarness;

    await flow.orchestrator.next({
      conversation_id: conversationId,
      new_events: [{
        type: 'user_input',
        content: '填写当前表格单元格。',
        timestamp: Date.now(),
        source: 'system',
      }],
      options: {
        promptKey: 'table_ai_fill',
        model_id: 'scripted-test-model',
        host_tool_call: {
          tool_name: 'write_to_table',
          args: {
            content: '企业知识库，让智慧触手可及。',
            mode: 'replace',
          },
        },
      },
    }, () => {});

    const persistedEvents = await readPersistedRuntimeEvents(flow.runtimePersistence, conversationId);
    const decisions = persistedEvents.filter((event): event is ToolCallDecisionEvent => (
      isToolCallDecisionEvent(event) && event.tool_name === 'write_to_table'
    ));
    const outputs = persistedEvents.filter((event): event is ToolOutputEvent => (
      isToolOutputEvent(event) && event.tool_name === 'write_to_table'
    ));
    const finalAnswers = persistedEvents.filter((event): event is FinalAnswerEvent => (
      isFinalAnswerEvent(event) && event.content === '企业知识库，让智慧触手可及。'
    ));

    expect(decisions).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(finalAnswers).toHaveLength(1);
    expect(persistedEvents.indexOf(outputs[0])).toBeLessThan(persistedEvents.indexOf(finalAnswers[0]));
    aiHarness.assertAllTurnsConsumed();
  });

  it('host 指定工具应继承 root run 的取消信号', async () => {
    const conversationId = 'conv_host_forced_tool_abort';
    const blockingTool = new HostOnlyBlockingTool();
    aiHarness = createScriptedInferenceHarness([]);
    const flow = await createHostToolFlow(blockingTool, aiHarness);
    toolHarness = flow.toolHarness;
    const abortController = new AbortController();
    const liveEvents: ConversationRealtimeEvent[] = [];

    const execution = flow.orchestrator.next({
      conversation_id: conversationId,
      new_events: [{
        type: 'user_input',
        content: '启动一个可取消的系统任务。',
        timestamp: Date.now(),
        source: 'system',
      }],
      options: {
        promptKey: 'default',
        model_id: 'scripted-test-model',
        host_tool_call: { tool_name: 'host_only_blocking_probe', args: {} },
      },
    }, (event) => {
      liveEvents.push(event);
    }, abortController.signal);

    await blockingTool.started;
    expect(liveEvents.some((event) => (
      event.type === 'tool_call_decision'
      && event.tool_name === 'host_only_blocking_probe'
      && event.status === 'loading'
    ))).toBe(true);
    expect(liveEvents.some((event) => event.type === 'tool_output')).toBe(false);

    abortController.abort('integration-test');
    const result = await execution;

    expect(result.terminationReason).toBe('interrupted');
    expect(aiHarness.getConsumedTurnCount()).toBe(0);
    const persistedEvents = await readPersistedRuntimeEvents(flow.runtimePersistence, conversationId);
    expect(persistedEvents.filter((event) => (
      isToolCallDecisionEvent(event) && event.tool_name === 'host_only_blocking_probe'
    ))).toHaveLength(1);
    expect(persistedEvents.some(isFinalAnswerEvent)).toBe(false);
  });
});
