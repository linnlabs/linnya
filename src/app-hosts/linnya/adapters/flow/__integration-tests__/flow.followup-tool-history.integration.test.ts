import { afterEach, describe, expect, it, vi } from 'vitest';

// 历史遗留：曾经 vi.mock('src/agent/shared/TokenCalculator', ...)，但 src/agent
// 已搬到独立 Linnkit 仓，且 TokenCalculator 是 Linnkit 内部 internal-only
// 模块（GUARD-09 禁止外部 import）。生产代码从来不用 'src/agent/...' 这个 specifier
// 直接 import 它，所以历史 mock 自始至终未生效（vi.mock 静默 no-op），删之。
// 真要在测试里替换 TokenCalculator，应改在 linnkit 内部用依赖注入或单独提供
// 一个 testkit harness，而不是从外部 mock 一个内部模块。
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
import { FlowOrchestrator } from 'src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import { FlowIncomingEventPreparer } from 'src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import { AgentRunnerService } from 'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { createAgentRunnerRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/agentRunnerRuntimeHarness';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import { createDirectFlowConversationAdmissionPort } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDirectFlowConversationAdmissionPort';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import {
  createToolRuntimeHarness,
  type ToolRuntimeHarness,
} from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import {
  createScriptedInferenceHarness,
  type ScriptedInferenceHarness,
} from '@linnlabs/linnkit/testkit';
import type { CanonicalInferenceMessage } from '@linnlabs/linnkit/ports';
import type {
  FinalAnswerEvent,
  ProviderContinuation,
  RuntimeEvent,
  ToolCallDecisionEvent,
  ToolProcessEvent,
} from '@linnlabs/linnkit/contracts';
import {
  buildFlowIntegrationEngine,
  createFlowIntegrationRuntimePersistence,
  InMemoryFlowEventStore,
} from 'src/app-hosts/linnya/testkit/agent-harness/flowIntegrationHarness';

class TestWebSearchTool extends BaseTool {
  readonly name = 'web_search';
  readonly description = '测试用联网搜索工具。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词。',
      },
      top_k: {
        type: 'number',
        description: '返回数量。',
      },
    },
    required: ['query'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const query = typeof args.query === 'string' ? args.query : '';
    return JSON.stringify({
      observation: `搜索结果：${query}`,
      data: {
        query,
      },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function providerContinuation(reasoning: string): ProviderContinuation[] {
  return [{
    schema_version: 2,
    producer: {
      model_id: 'scripted-test-model',
      endpoint_id: 'scripted',
      api_surface: 'mock',
      capability_id: 'host:mock',
      endpoint_model_id: 'scripted-test-model',
    },
    kind: 'reasoning_content',
    payload: { type: 'reasoning_content', reasoning_content: reasoning },
  }];
}

function hasAssistantToolCallMessage(
  messages: readonly CanonicalInferenceMessage[],
  toolName: string
): boolean {
  return messages.some(message =>
    message.role === 'assistant' && message.parts.some(
      part => part.type === 'tool_call' && part.call.name === toolName
    )
  );
}

function findAssistantToolCallMessage(
  messages: readonly CanonicalInferenceMessage[],
  toolName: string
): Extract<CanonicalInferenceMessage, { role: 'assistant' }> | undefined {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (message.parts.some(part => part.type === 'tool_call' && part.call.name === toolName)) {
      return message;
    }
  }
  return undefined;
}

function textContent(message: CanonicalInferenceMessage): string {
  if (message.role === 'system') return message.content;
  if (message.role === 'assistant') {
    return message.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('');
  }
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
}

function findUserMessageIndexes(
  messages: readonly CanonicalInferenceMessage[],
  content: string
): number[] {
  const indexes: number[] = [];
  messages.forEach((message, index) => {
    if (message.role !== 'user') return;
    if (!textContent(message).includes(content)) return;
    indexes.push(index);
  });
  return indexes;
}

function findLastAssistantToolCallsIndex(messages: readonly CanonicalInferenceMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (message.parts.some(part => part.type === 'tool_call')) {
      return index;
    }
  }
  return -1;
}

function findLastToolMessageIndex(messages: readonly CanonicalInferenceMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'tool') {
      return index;
    }
  }
  return -1;
}

function findLastMessageRole(messages: readonly CanonicalInferenceMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message) return message.role;
  }
  return undefined;
}

function isToolCallDecisionEvent(event: RuntimeEvent): event is ToolCallDecisionEvent {
  return event.type === 'tool_call_decision';
}

function isToolProcessEvent(event: RuntimeEvent): event is ToolProcessEvent {
  return event.type === 'tool_process';
}

function isFinalAnswerEvent(event: RuntimeEvent): event is FinalAnswerEvent {
  return event.type === 'final_answer';
}

describe('Flow follow-up tool history integration', () => {
  let aiHarness: ScriptedInferenceHarness | undefined;
  let toolHarness: ToolRuntimeHarness | undefined;

  afterEach(() => {
    toolHarness?.restore();
    aiHarness = undefined;
    toolHarness = undefined;
    vi.restoreAllMocks();
  });

  it('应在跨轮 follow-up 时保留上一轮的 tool_calls 锚点', async () => {
    const conversationId = 'conv_followup_tool_history';
    const followupPrompt = '继续基于上一次工具结果回答。';
    const providerContinuations = providerContinuation('Need web search.');
    const finalAnswerContinuations = providerContinuation('Synthesize search result.');
    const eventStore = new InMemoryFlowEventStore();
    const historyRepository = new HistoryRepository(eventStore);
    const historyHandler = new HistoryHandlerService(
      createFlowHistoryAccessPort(historyRepository),
    );
    const persistenceCoordinator = new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    });
    aiHarness = createScriptedInferenceHarness([
      {
        contentChunks: ['我先搜索一下。'],
        toolCalls: [
          {
            id: 'call_search_1',
            name: 'web_search',
            argumentsJson: '{"query":"人工智能","top_k":3}',
            continuations: providerContinuations,
          },
        ],
      },
      {
        contentChunks: ['第一轮已完成搜索。'],
        textContinuations: finalAnswerContinuations,
      },
      {
        contentChunks: ['第二轮继续回答。'],
        assertCall: (call) => {
          expect(hasAssistantToolCallMessage(call.messages, 'web_search')).toBe(true);
          const assistantToolCall = findAssistantToolCallMessage(call.messages, 'web_search');
          const toolPart = assistantToolCall?.parts.find(part => part.type === 'tool_call');
          expect(toolPart?.type === 'tool_call' ? toolPart.call.continuation : undefined)
            .toEqual(providerContinuations);
          const hasToolOutput = call.messages.some(message =>
            message.role === 'tool' && textContent(message).includes('搜索结果：人工智能')
          );
          expect(hasToolOutput).toBe(true);
          const followupUserIndexes = findUserMessageIndexes(call.messages, followupPrompt);
          expect(followupUserIndexes).toHaveLength(1);
          expect(findLastToolMessageIndex(call.messages)).toBeLessThan(followupUserIndexes[0]);
          expect(findLastMessageRole(call.messages)).toBe('user');
          const finalAssistant = call.messages.find(message =>
            message.role === 'assistant' && textContent(message) === '第一轮已完成搜索。'
          );
          const textPart = finalAssistant?.role === 'assistant'
            ? finalAssistant.parts.find(part => part.type === 'text')
            : undefined;
          expect(textPart?.type === 'text' ? textPart.continuation : undefined)
            .toEqual(finalAnswerContinuations);
        },
      },
    ]);
    toolHarness = createToolRuntimeHarness([new TestWebSearchTool()]);
    const engine = await buildFlowIntegrationEngine({
      llmCaller: aiHarness.getLlmCaller(),
      toolRuntime: toolHarness.toolRuntime,
    });
    const runtime = createFlowIntegrationRuntimePersistence(eventStore);
    const runner = new AgentRunnerService(
      engine,
      { searchDocuments: vi.fn().mockResolvedValue([]) } as unknown as import('src/features/knowledge-base/application/knowledgeBaseService').KnowledgeBaseService,
      { getDb: vi.fn() } as unknown as import('src/electron-main/services/database').DatabaseService,
      createAgentRunnerRuntimeHarness({ costCollector: runtime.costCollector }),
    );
    const orchestrator = new FlowOrchestrator(
      historyHandler,
      runner,
      persistenceCoordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      runtime,
    );

    const firstRequest: ConversationNextRequest = {
      conversation_id: conversationId,
      new_events: [
        {
          type: 'user_input',
          content: '先搜索一下人工智能，再告诉我结果。',
          timestamp: Date.now(),
          source: 'user',
        },
      ],
      options: {
        promptKey: 'default',
        model_id: 'scripted-test-model',
      },
    };

    await orchestrator.next(firstRequest, () => {});

    const firstHistory = await historyRepository.readFrom(conversationId, 0);
    const searchDecisions = firstHistory.events.filter((event): event is ToolCallDecisionEvent => {
      if (!isToolCallDecisionEvent(event)) return false;
      return event.tool_name === 'web_search' && event.tool_call_id === 'call_search_1';
    });
    const searchProcesses = firstHistory.events.filter((event): event is ToolProcessEvent => {
      if (!isToolProcessEvent(event)) return false;
      return event.tool_name === 'web_search' && event.tool_call_id === 'call_search_1';
    });

    expect(searchDecisions).toHaveLength(1);
    expect(searchDecisions[0].payload?.provider_continuations).toEqual(providerContinuations);
    expect(searchProcesses).toHaveLength(0);
    const firstFinalAnswer = firstHistory.events.find((event): event is FinalAnswerEvent => {
      return isFinalAnswerEvent(event) && event.content === '第一轮已完成搜索。';
    });
    expect(firstFinalAnswer?.provider_continuations).toEqual(finalAnswerContinuations);

    const followupRequest: ConversationNextRequest = {
      conversation_id: conversationId,
      new_events: [
        {
          type: 'user_input',
          content: followupPrompt,
          timestamp: Date.now() + 1,
          source: 'user',
        },
      ],
      options: {
        promptKey: 'default',
        model_id: 'scripted-test-model',
      },
    };

    await orchestrator.next(followupRequest, () => {});

    aiHarness.assertAllTurnsConsumed();
  });

  it('应在同一轮 tool 续跑时保持当前 user 只出现一次且顺序正确', async () => {
    const conversationId = 'conv_same_turn_tool_order';
    const currentPrompt = '你是谁，你为什么叫linnya';
    const eventStore = new InMemoryFlowEventStore();
    const historyRepository = new HistoryRepository(eventStore);
    const historyHandler = new HistoryHandlerService(
      createFlowHistoryAccessPort(historyRepository),
    );
    const persistenceCoordinator = new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    });
    aiHarness = createScriptedInferenceHarness([
      {
        contentChunks: ['我先搜索一下。'],
        toolCalls: [
          {
            id: 'call_search_same_turn_1',
            name: 'web_search',
            argumentsJson: '{"query":"linnya"}',
          },
        ],
      },
      {
        contentChunks: ['我是 Linnya。'],
        assertCall: (call) => {
          const userIndexes = findUserMessageIndexes(call.messages, currentPrompt);
          const assistantToolCallsIndex = findLastAssistantToolCallsIndex(call.messages);
          const toolIndex = findLastToolMessageIndex(call.messages);

          expect(userIndexes).toHaveLength(1);
          expect(assistantToolCallsIndex).toBeGreaterThan(userIndexes[0]);
          expect(toolIndex).toBeGreaterThan(assistantToolCallsIndex);
          expect(findLastMessageRole(call.messages)).toBe('tool');
        },
      },
    ]);
    toolHarness = createToolRuntimeHarness([new TestWebSearchTool()]);
    const engine = await buildFlowIntegrationEngine({
      llmCaller: aiHarness.getLlmCaller(),
      toolRuntime: toolHarness.toolRuntime,
    });
    const runtime = createFlowIntegrationRuntimePersistence(eventStore);
    const runner = new AgentRunnerService(
      engine,
      { searchDocuments: vi.fn().mockResolvedValue([]) } as unknown as import('src/features/knowledge-base/application/knowledgeBaseService').KnowledgeBaseService,
      { getDb: vi.fn() } as unknown as import('src/electron-main/services/database').DatabaseService,
      createAgentRunnerRuntimeHarness({ costCollector: runtime.costCollector }),
    );
    const orchestrator = new FlowOrchestrator(
      historyHandler,
      runner,
      persistenceCoordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      runtime,
    );

    const request: ConversationNextRequest = {
      conversation_id: conversationId,
      new_events: [
        {
          type: 'user_input',
          content: currentPrompt,
          timestamp: Date.now(),
          source: 'user',
        },
      ],
      options: {
        promptKey: 'default',
        model_id: 'scripted-test-model',
      },
    };

    await orchestrator.next(request, () => {});

    aiHarness.assertAllTurnsConsumed();
  });

});
