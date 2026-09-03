import { describe, expect, it, vi } from 'vitest';
import type { AgentInvocationRequest } from '../../../ports/agent-invocation';
import type { LlmRequestMessage, TokenizerPort } from '../../../ports';
import type {
  EngineState,
  GraphNode,
  NodeResult,
  RuntimeEventSink,
} from '../../graph-engine/types';
import { EventBus, EventSequencer, RuntimeEventPublisher } from '../../execution';
import { ChildRunInvoker } from '../childRunInvoker';
import { GraphAgentExecutor } from '../../graph-engine/executor';
import { LlmNode } from '../../graph-engine/nodes/llmNode';
import {
  ensureToolContextRuntimeCapability,
  getToolContextRuntimeBinding,
  readToolContextPersistedHistory,
  readToolContextWorkingHistory,
} from '../../tools/toolContextRuntime';
import type {
  ObservationPreviewPort,
  ToolRuntimeDefinition,
  ToolRuntimePort,
} from '../../tools/ports';
import type { ToolExecutionContext } from '../../tools/toolExecutionContext';
import type { AuditEnvelope } from '../../../contracts/audit';
import type { RuntimeEvent, UserInputEvent } from '../../../contracts';
import { DEFAULT_MAX_CHILD_RUN_DEPTH } from '../types';
import {
  createHistorySummaryEvent,
  DEFAULT_CONTEXT_COMPACTION_POLICY,
  RunIdSchema,
  ToolCallIdSchema,
} from '../../../contracts';

const noopObservationPreview: ObservationPreviewPort = {
  async truncateObservation({ text }) {
    return { truncated: false, preview: text };
  },
};

const noopToolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'> = {
  getToolDefinition: () => undefined,
  async executeTool() {
    return { success: false, error: 'tool runtime not configured', durationMs: 0 };
  },
};

function createChildRuntimeEventSink(publishedEvents?: RuntimeEvent[]): RuntimeEventSink {
  const sequencer = new EventSequencer('child-invoker-test');
  const eventBus = new EventBus(sequencer.getExecutionId());
  const publisher = new RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('child-invoker-test-run'),
    parent_run_id: RunIdSchema.parse('child-invoker-test-parent'),
    lane: 'child',
    visibility: 'parent-trace',
  });
  return (event, source) => {
    const published = publisher.publish(event, source);
    publishedEvents?.push(published);
    return published;
  };
}

describe('ChildRunInvoker', () => {
  it('独立历史策略下仍把 Host 冻结的环境注入透传给 child 请求', async () => {
    const capturedRequests: AgentInvocationRequest[] = [];
    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        const request = isAgentInvocationRequest(state.local?.request)
          ? state.local.request
          : undefined;
        if (request) capturedRequests.push(request);
        return { kind: 'yield', events: [] };
      },
    };
    const childRunContextInjections = [{
      kind: 'project-context',
      content: 'project name: test\nproject files:\n1. report.md',
    }];
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: () => 'child-model' },
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    await invoker.invoke({
      agentConfig: { id: 'context-child-agent', promptKey: 'default' },
      userMessage: 'inspect project',
      parentToolContext: { childRunContextInjections },
      conversationId: 'child-context-conversation',
      runtimeEventSink: createChildRuntimeEventSink(),
    });

    expect(capturedRequests[0]?.conversationHistory).toBeUndefined();
    expect(capturedRequests[0]?.fences).toEqual(childRunContextInjections);
    expect(capturedRequests[0]?.fences).not.toBe(childRunContextInjections);
  });

  it('把 child lifecycle 的 RuntimeEvent 提交端口原样注入 Graph local', async () => {
    const runtimeEventCommitPort = vi.fn(async () => undefined);
    let capturedCommitPort: unknown;
    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        capturedCommitPort = state.local?.runtimeEventCommitPort;
        return { kind: 'yield', events: [] };
      },
    };
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: () => 'child-model' },
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    await invoker.invoke({
      agentConfig: { id: 'commit-port-child-agent', promptKey: 'default' },
      userMessage: '继续',
      parentToolContext: {},
      conversationId: 'child-commit-port-conversation',
      runtimeEventSink: createChildRuntimeEventSink(),
      runtimeEventCommitPort,
    });

    expect(capturedCommitPort).toBe(runtimeEventCommitPort);
    expect(runtimeEventCommitPort).not.toHaveBeenCalled();
  });

  it('child 自动压缩先持久化摘要，再通过 child admission 发布并调用主模型', async () => {
    const publishedEvents: RuntimeEvent[] = [];
    const order: string[] = [];
    const summaryEvent = createHistorySummaryEvent(
      'child-summary-1',
      'child-summary-conversation',
      'child-summary-turn',
      'child checkpoint',
      ['child-old-1'],
      1,
      1,
      { compression_ratio: 0.2 },
    );
    const promptBudget = {
      effectiveWindowTokens: 120,
      outputLimitTokens: 20,
      inputBudgetTokens: 100,
      toolDefinitionTokens: 0,
      messageBudgetTokens: 100,
    };
    const estimateMessage = (message: LlmRequestMessage): number => {
      const content = 'content' in message && typeof message.content === 'string'
        ? message.content
        : '';
      if (content === 'MAIN') return 85;
      if (content === 'REBUILT') return 40;
      if (content === 'compact-control') return 3;
      if (content === 'old facts') return 4;
      return 0;
    };
    const tokenizer: TokenizerPort = {
      estimateText: () => 0,
      estimateMessage,
    };
    const reasoner = new GraphAgentExecutor({
      llmCaller: {
        call: vi.fn(async () => {
          order.push('compaction-call');
          return { content: 'child checkpoint' };
        }),
        callWithRetries: vi.fn(async () => {
          order.push('main-call');
          return { content: 'child done' };
        }),
      },
      toolRuntime: {
        getToolSchemas: () => [],
        getToolDefinition: () => undefined,
      },
      contextBuilder: {
        build: async () => ({
          llmMessages: [{ role: 'user', content: 'MAIN' }],
          promptBudget,
          promptUsageMeasurementPolicy: {
            remote_count_enabled: false,
            remote_count_failure_behavior: 'use-local-estimate',
          },
          contextCompactionPolicy: DEFAULT_CONTEXT_COMPACTION_POLICY,
          contextCompactionCandidate: {
            plan: {
              fingerprint: 'child-plan',
              sourceMessageIds: ['child-root', 'child-goal', 'child-old-1'],
              replacedMessageIds: ['child-old-1'],
              originalMessageCount: 1,
              includedOldSummary: false,
              nextSummarySeq: 1,
              sourceTokenEstimate: 40,
              replacedTokenEstimate: 100,
              replacedToolGroupCount: 1,
              keptToolGroupCount: 2,
              replaceableRangeExhausted: true,
            },
            policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
            reminder: 'compact-control',
          },
        }),
        applyCompaction: async () => ({
          kind: 'ready' as const,
          rebuiltContext: {
            llmMessages: [{ role: 'user', content: 'REBUILT' }],
            promptBudget,
            promptUsageMeasurementPolicy: {
              remote_count_enabled: false,
              remote_count_failure_behavior: 'use-local-estimate' as const,
            },
          },
          pendingSummaryEvent: summaryEvent,
          compressionRatio: 0.2,
          summaryTokenEstimate: 20,
        }),
      },
      modelCatalog: {
        getModelById: () => ({
          id: 'child-model',
          enabled: true,
          capabilities: ['chat'],
          inference_route: {
            context_window_tokens: 120,
            max_output_tokens: 20,
          },
        }),
        getModelsByCapability: () => [],
        getModelsByUIVisibility: () => [],
      },
      modelResolver: { resolveModelId: () => 'child-model' },
      tokenizer,
    });
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: () => 'child-model' },
      createLlmNode: () => new LlmNode({ reasoner }),
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    const childSink = createChildRuntimeEventSink(publishedEvents);
    const runtimeEventCommitPort = vi.fn(async () => {
      order.push('durable-commit');
    });

    await invoker.invoke({
      agentConfig: {
        id: 'summary-child-agent',
        promptKey: 'default',
      },
      userMessage: '继续',
      parentToolContext: {},
      conversationId: 'child-summary-conversation',
      runtimeEventSink: (event, source) => {
        if (event.type === 'history_summary') order.push('summary-event');
        return childSink(event, source);
      },
      runtimeEventCommitPort,
    });

    expect(publishedEvents.filter(event => event.type === 'history_summary')).toEqual([
      expect.objectContaining({
        id: 'child-summary-1',
        conversation_id: 'child-summary-conversation',
      }),
    ]);
    expect(order).toEqual([
      'compaction-call',
      'durable-commit',
      'summary-event',
      'main-call',
    ]);
  });

  it('默认模型兜底应显式走 ModelResolver，而不是借道 LlmCaller', async () => {
    const capturedRequests: AgentInvocationRequest[] = [];
    const modelResolver = {
      resolveModelId: vi.fn(() => 'default-model-from-resolver'),
    };

    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        const request = isAgentInvocationRequest(state.local?.request)
          ? state.local.request
          : undefined;
        if (request) {
          capturedRequests.push(request);
        }
        return { kind: 'yield', events: [] };
      },
    };

    const invoker = new ChildRunInvoker({
      modelResolver,
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    await invoker.invoke({
      agentConfig: {
        id: 'internal-agent',
        promptKey: 'default',
      },
      userMessage: '继续执行',
      parentToolContext: {},
      conversationId: 'child-conversation-default-model',
      runtimeEventSink: createChildRuntimeEventSink(),
    });

    expect(modelResolver.resolveModelId).toHaveBeenCalledTimes(1);
    expect(capturedRequests[0]?.model_id).toBe('default-model-from-resolver');
  });

  it('子 agent 固定模型优先级应高于默认 ModelResolver', async () => {
    const capturedRequests: AgentInvocationRequest[] = [];
    const capturedExecutorLocal: Record<string, unknown>[] = [];
    const modelResolver = {
      resolveModelId: vi.fn(() => 'default-model-from-resolver'),
    };

    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        const request = isAgentInvocationRequest(state.local?.request)
          ? state.local.request
          : undefined;
        if (request) {
          capturedRequests.push(request);
        }
        if (isRecord(state.local?.executorLocal)) {
          capturedExecutorLocal.push(state.local.executorLocal);
        }
        return { kind: 'yield', events: [] };
      },
    };

    const invoker = new ChildRunInvoker({
      modelResolver,
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    await invoker.invoke({
      agentConfig: {
        id: 'fixed-child-agent',
        promptKey: 'fixed',
        modelPolicy: { kind: 'fixed', modelId: 'fixed-child-model' },
      },
      userMessage: '继续执行',
      parentToolContext: {},
      conversationId: 'child-conversation-fixed-model',
      runtimeEventSink: createChildRuntimeEventSink(),
    });

    expect(modelResolver.resolveModelId).not.toHaveBeenCalled();
    expect(capturedRequests[0]?.model_id).toBe('fixed-child-model');
    expect(capturedExecutorLocal[0]?.lockRequestedModelId).toBe(true);
  });

  it('显式传入 child-run modelId 时才允许覆盖子 agent 固定模型', async () => {
    const capturedRequests: AgentInvocationRequest[] = [];
    const capturedExecutorLocal: Record<string, unknown>[] = [];
    const modelResolver = {
      resolveModelId: vi.fn(() => 'default-model-from-resolver'),
    };

    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        const request = isAgentInvocationRequest(state.local?.request)
          ? state.local.request
          : undefined;
        if (request) {
          capturedRequests.push(request);
        }
        if (isRecord(state.local?.executorLocal)) {
          capturedExecutorLocal.push(state.local.executorLocal);
        }
        return { kind: 'yield', events: [] };
      },
    };

    const invoker = new ChildRunInvoker({
      modelResolver,
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    await invoker.invoke({
      agentConfig: {
        id: 'fixed-child-agent',
        promptKey: 'fixed',
        modelPolicy: { kind: 'fixed', modelId: 'fixed-child-model' },
      },
      userMessage: '继续执行',
      parentToolContext: {},
      conversationId: 'child-conversation-explicit-model',
      runtimeEventSink: createChildRuntimeEventSink(),
      modelId: 'explicit-child-model',
    });

    expect(modelResolver.resolveModelId).not.toHaveBeenCalled();
    expect(capturedRequests[0]?.model_id).toBe('explicit-child-model');
    expect(capturedExecutorLocal[0]?.lockRequestedModelId).toBeUndefined();
  });

  it('连续工具步骤始终复用同一个正式 child user_input 身份', async () => {
    const publishedEvents: RuntimeEvent[] = [];
    const capturedHistories: RuntimeEvent[][] = [];
    const capturedRequests: AgentInvocationRequest[] = [];
    let llmTicks = 0;
    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        const request = isAgentInvocationRequest(state.local?.request)
          ? state.local.request
          : undefined;
        if (!request) throw new Error('child request missing');
        capturedRequests.push(request);
        capturedHistories.push([...(state.local?.history ?? [])]);
        llmTicks += 1;
        if (llmTicks === 1) {
          state.local = {
            ...(state.local ?? {}),
            pendingToolCalls: [
              {
                id: ToolCallIdSchema.parse('call-child-state'),
                type: 'function',
                function: { name: 'read_state', arguments: '{}' },
              },
            ],
          };
          return { kind: 'route', nextNodeId: 'tool', events: [] };
        }
        return { kind: 'yield', events: [] };
      },
    };
    const toolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'> = {
      getToolDefinition: () => ({ parameters: { type: 'object', properties: {} } }),
      async executeTool() {
        return { success: true, result: '{"exists":false}', durationMs: 1 };
      },
    };
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: () => 'test-model' },
      createLlmNode: () => llmNode,
      toolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: () => [],
    });

    await invoker.invoke({
      agentConfig: {
        id: 'stateful-child',
        promptKey: 'default',
        availableTools: ['read_state'],
      },
      userMessage: '依次读取并处理任务状态',
      parentToolContext: {
        conversationId: 'conversation-child-user',
        runId: RunIdSchema.parse('parent-run'),
      },
      conversationId: 'conversation-child-user',
      runId: RunIdSchema.parse('child-run-user'),
      parentRunId: RunIdSchema.parse('parent-run'),
      runtimeEventSink: createChildRuntimeEventSink(publishedEvents),
      maxSteps: 3,
    });

    const childUserFacts = publishedEvents.filter(event => event.type === 'user_input');
    expect(childUserFacts).toHaveLength(1);
    expect(childUserFacts[0]).toMatchObject({
      content: '依次读取并处理任务状态',
      source: 'system',
      run_id: 'child-invoker-test-run',
      lane: 'child',
      visibility: 'parent-trace',
    });
    expect(capturedRequests).toHaveLength(2);
    expect(
      capturedRequests.every(request => request.currentUserEventId === childUserFacts[0]?.id)
    ).toBe(true);
    for (const history of capturedHistories) {
      const userFacts = history.filter(event => event.type === 'user_input');
      expect(userFacts.map(event => event.id)).toEqual([childUserFacts[0]?.id]);
    }
    expect(capturedHistories[1]?.findIndex(event => event.id === childUserFacts[0]?.id)).toBe(0);
    expect(capturedHistories[1]?.some(event => event.type === 'tool_output')).toBe(true);
  });

  it('应为 child ToolContext 显式建立独立 runtime binding，而不是继承父级 capability 表面', async () => {
    let capturedToolContext: Record<string, unknown> | undefined;
    const parentHistory = [
      {
        id: 'parent-user',
        type: 'user_input',
        conversation_id: 'parent-conversation',
        turn_id: 'parent-turn',
        timestamp: Date.now(),
        version: 1,
        source: 'user',
        content: 'parent history',
      } satisfies UserInputEvent,
    ];
    const seedHistory = [
      {
        id: 'seed-user',
        type: 'user_input',
        conversation_id: 'child-conversation',
        turn_id: 'child-turn',
        timestamp: Date.now(),
        version: 1,
        source: 'user',
        content: 'seed history',
      } satisfies UserInputEvent,
    ];
    const parentToolContext: Record<string, unknown> = {
      childRunDepth: 2,
      userQuery: '父级任务',
      modelId: 'parent-model',
      customService: { ok: true },
    };

    const parentBinding = ensureToolContextRuntimeCapability({
      context: parentToolContext,
      persistedHistory: parentHistory,
      workingHistory: parentHistory,
      executionMeta: {
        conversationId: 'parent-conversation',
        turnId: 'parent-turn',
        runId: RunIdSchema.parse('parent-run'),
        parentToolCallId: ToolCallIdSchema.parse('parent-tool-call'),
      },
    });

    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        capturedToolContext = isRecord(state.local?.toolContext)
          ? state.local.toolContext
          : undefined;
        return { kind: 'yield', events: [] };
      },
    };

    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'default-model-from-resolver') },
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    await invoker.invoke({
      agentConfig: {
        id: 'internal-agent',
        promptKey: 'default',
      },
      userMessage: '继续执行',
      parentToolContext,
      runtimeEventSink: createChildRuntimeEventSink(),
      runId: RunIdSchema.parse('child-run-1'),
      parentRunId: RunIdSchema.parse('parent-run'),
      seedHistoryEvents: seedHistory,
      modelId: 'child-model',
    });

    expect(capturedToolContext).toBeDefined();
    const childToolContext = capturedToolContext as typeof parentToolContext;
    const childBinding = getToolContextRuntimeBinding(childToolContext);

    expect(childBinding).toBeDefined();
    expect(childBinding).not.toBe(parentBinding);
    expect(childToolContext.conversationView).not.toBe(parentToolContext.conversationView);
    const persistedChildHistory = readToolContextPersistedHistory(childToolContext);
    const workingChildHistory = readToolContextWorkingHistory(childToolContext);
    expect(persistedChildHistory[0]?.id).toBe('seed-user');
    expect(persistedChildHistory[1]).toMatchObject({
      type: 'user_input',
      content: '继续执行',
    });
    expect(workingChildHistory.map(event => event.id)).toEqual(
      persistedChildHistory.map(event => event.id)
    );
    expect(childToolContext.conversationId).toBe('parent-conversation');
    expect(childToolContext.turnId).toBe(persistedChildHistory[1]?.turn_id);
    expect(childToolContext.runId).toBe('child-run-1');
    expect(childToolContext.parentRunId).toBe('parent-run');
    expect(childToolContext.parentToolCallId).toBeUndefined();
    expect(childToolContext.childRunDepth).toBe(3);
    expect(childToolContext.userQuery).toBe('继续执行');
    expect(childToolContext.modelId).toBe('child-model');
    expect(childToolContext.abortSignal).toBeUndefined();
    expect(childToolContext.customService).toBe(parentToolContext.customService);

    expect(readToolContextWorkingHistory(parentToolContext)).toBe(parentHistory);
    expect(parentToolContext.conversationId).toBe('parent-conversation');
    expect(parentToolContext.turnId).toBe('parent-turn');
    expect(parentToolContext.runId).toBe('parent-run');
    expect(parentToolContext.parentToolCallId).toBe('parent-tool-call');
  });

  it('应允许 host 显式指定 child-run 审计会话，同时继续用内部 checkpoint key 隔离执行状态', async () => {
    let capturedLlmConversationId: string | undefined;
    let capturedToolContext: ToolExecutionContext | undefined;
    const emittedAudit: AuditEnvelope[] = [];
    const emittedTelemetry: unknown[] = [];
    const childToolDefinition: ToolRuntimeDefinition = {
      parameters: { type: 'object', properties: {} },
    };
    const toolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'> = {
      getToolDefinition: vi.fn(() => childToolDefinition),
      executeTool: vi.fn(async (_toolName, _args, context) => {
        capturedToolContext = context;
        return {
          success: true,
          result: JSON.stringify({ data: {}, observation: 'tool ok' }),
          durationMs: 1,
        };
      }),
    };

    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        capturedLlmConversationId =
          typeof state.local?.conversationId === 'string' ? state.local.conversationId : undefined;
        state.local = {
          ...(state.local ?? {}),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_child_tool'),
              type: 'function',
              function: {
                name: 'child_tool',
                arguments: '{"value":"hello"}',
              },
            },
          ],
        };
        return { kind: 'route', nextNodeId: 'tool', events: [] };
      },
    };

    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'default-model-from-resolver') },
      createLlmNode: () => llmNode,
      toolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
      telemetryPort: {
        emit: vi.fn(event => {
          emittedTelemetry.push(event);
        }),
      },
      auditPort: {
        emit: vi.fn(async (envelope: AuditEnvelope) => {
          emittedAudit.push(envelope);
        }),
      },
    });

    const result = await invoker.invoke({
      agentConfig: {
        id: 'internal-agent',
        promptKey: 'default',
        availableTools: ['child_tool'],
      },
      userMessage: '调用子工具',
      parentToolContext: {
        conversationId: 'parent-conversation',
        runId: RunIdSchema.parse('parent-run'),
      },
      runtimeEventSink: createChildRuntimeEventSink(),
      conversationId: 'registered-conversation',
      runId: RunIdSchema.parse('child-run-1'),
      parentRunId: RunIdSchema.parse('parent-run'),
      maxSteps: 3,
    });

    expect(result.success).toBe(true);
    expect(result.events.some(event => event.type === 'tool_output')).toBe(true);
    expect(capturedLlmConversationId).toBe('registered-conversation');
    expect(capturedToolContext?.conversationId).toBe('registered-conversation');
    expect(capturedToolContext?.runId).toBe('child-run-1');
    expect(capturedToolContext?.parentRunId).toBe('parent-run');
    expect(
      emittedTelemetry
        .filter(isTelemetryWithScope)
        .filter(event => event.kind === 'run_lifecycle' || event.kind === 'graph_node')
        .every(event => event.scope.conversationId === 'registered-conversation')
    ).toBe(true);
    expect(emittedAudit).toContainEqual(
      expect.objectContaining({
        action: 'tool.allow',
        runId: 'child-run-1',
        parentRunId: 'parent-run',
        scope: expect.objectContaining({
          conversationId: 'registered-conversation',
          runId: 'child-run-1',
          parentRunId: 'parent-run',
          toolName: 'child_tool',
        }),
      })
    );
    expect(emittedAudit).not.toContainEqual(
      expect.objectContaining({
        action: 'run.transcript',
      })
    );
  });

  it('调用前已经 abort 时应返回 cancelled result，而不是抛出 AbortError', async () => {
    const abortController = new AbortController();
    abortController.abort('user cancelled before child run');
    const publishedEvents: RuntimeEvent[] = [];
    const llmNode: GraphNode = {
      id: 'llm',
      async run(): Promise<NodeResult> {
        throw new Error('llm node should not run after abort');
      },
    };
    const createLlmNode = vi.fn((): GraphNode => llmNode);
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'default-model-from-resolver') },
      createLlmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    const result = await invoker.invoke({
      agentConfig: {
        id: 'internal-agent',
        promptKey: 'default',
      },
      userMessage: '继续执行',
      parentToolContext: {},
      runtimeEventSink: createChildRuntimeEventSink(publishedEvents),
      runId: RunIdSchema.parse('child-run-aborted-before-start'),
      abortSignal: abortController.signal,
    });

    expect(result).toMatchObject({
      runId: 'child-run-aborted-before-start',
      subrunId: 'child-run-aborted-before-start',
      success: false,
      cancelled: true,
      error: 'The user aborted a request.',
      events: [],
      stepCount: 0,
    });
    expect(createLlmNode).not.toHaveBeenCalled();
    expect(publishedEvents).toEqual([]);
  });

  it('执行信号已取消时即使 provider 抛普通 Error，也应返回 cancelled result', async () => {
    const abortController = new AbortController();
    const llmNode: GraphNode = {
      id: 'llm',
      async run(): Promise<NodeResult> {
        abortController.abort('user cancelled during child run');
        throw new Error('Stream cancelled by user');
      },
    };
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'default-model-from-resolver') },
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    const result = await invoker.invoke({
      agentConfig: {
        id: 'internal-agent',
        promptKey: 'default',
      },
      userMessage: '继续执行',
      parentToolContext: {},
      runtimeEventSink: createChildRuntimeEventSink(),
      conversationId: 'child-conversation',
      runId: RunIdSchema.parse('child-run-aborted-during-run'),
      abortSignal: abortController.signal,
    });

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.error).toBe('Stream cancelled by user');
    expect(result.events).toEqual([]);
  });

  it('同步 child run 路由到 wait_user 时应明确失败，不得伪装为已完成', async () => {
    const llmNode: GraphNode = {
      id: 'llm',
      async run(state: EngineState): Promise<NodeResult> {
        state.local = {
          ...(state.local ?? {}),
          pendingInteractionSpec: {
            prompt: '请选择输出范围',
            toolCallId: 'child-interaction-tool',
            toolName: 'interactive_form',
          },
        };
        return { kind: 'route', nextNodeId: 'wait_user', events: [] };
      },
    };
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'default-model-from-resolver') },
      createLlmNode: () => llmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    const result = await invoker.invoke({
      agentConfig: {
        id: 'interactive-child-agent',
        promptKey: 'default',
      },
      userMessage: '先向用户确认范围',
      parentToolContext: { runId: RunIdSchema.parse('parent-run') },
      runtimeEventSink: createChildRuntimeEventSink(),
      conversationId: 'conversation-child-interaction',
      runId: RunIdSchema.parse('child-run-interaction'),
      parentRunId: RunIdSchema.parse('parent-run'),
    });

    expect(result).toMatchObject({
      runId: 'child-run-interaction',
      parentRunId: 'parent-run',
      subrunId: 'child-run-interaction',
      success: false,
      cancelled: undefined,
      error:
        'Interactive tools are not supported in synchronous child runs; delegate the interaction to the foreground run',
    });
    expect(result.events.some(event => event.type === 'requires_user_interaction')).toBe(true);
  });

  it('父上下文 childRunDepth 已达上限时应返回失败结果且不启动子图', async () => {
    const createLlmNode = vi.fn<() => GraphNode>(() => ({
      id: 'llm',
      async run(): Promise<NodeResult> {
        throw new Error('llm node should not run after depth fuse');
      },
    }));
    const invoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'default-model-from-resolver') },
      createLlmNode,
      toolRuntime: noopToolRuntime,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
    });

    const result = await invoker.invoke({
      agentConfig: {
        id: 'internal-agent',
        promptKey: 'default',
      },
      userMessage: '继续递归',
      parentToolContext: { childRunDepth: DEFAULT_MAX_CHILD_RUN_DEPTH },
      runtimeEventSink: createChildRuntimeEventSink(),
      runId: RunIdSchema.parse('child-run-too-deep'),
    });

    expect(createLlmNode).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      runId: 'child-run-too-deep',
      subrunId: 'child-run-too-deep',
      success: false,
      events: [],
      stepCount: 0,
      error: `Child run depth limit exceeded: parent depth ${DEFAULT_MAX_CHILD_RUN_DEPTH}, max depth ${DEFAULT_MAX_CHILD_RUN_DEPTH}.`,
    });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAgentInvocationRequest(value: unknown): value is AgentInvocationRequest {
  return isRecord(value) && typeof value.query === 'string' && typeof value.promptKey === 'string';
}

function isTelemetryWithScope(value: unknown): value is {
  kind: string;
  scope: { conversationId?: string };
} {
  return isRecord(value) && typeof value.kind === 'string' && isRecord(value.scope);
}
