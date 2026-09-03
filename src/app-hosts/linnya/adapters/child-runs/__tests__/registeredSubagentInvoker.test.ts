import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptKeys } from '@app/schemas';
import {
  audit,
  childRuns,
  childRunTrace,
  execution,
  graph,
  llm,
  runSupervisor,
  tools,
} from 'linnkit/runtime-kernel';
import type { AgentInvocationRequest } from 'linnkit/ports';
import { RegisteredChildRunInvoker } from '../registeredSubagentInvoker';
import type { ResolvedRegisteredAgent } from '../registeredAgentResolver';
import {
  createFinalAnswerChunkEvent,
  createFinalAnswerEvent,
  createHistorySummaryEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createToolProcessEvent,
  createUserInputEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
  type SubRunTraceEvent,
  RunIdSchema,
  ToolCallIdSchema,
} from 'linnkit/contracts';
import { SQLiteRunRegistryStore } from 'src/app-hosts/linnya/adapters/persistence/run-registry';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import {
  LinnyaEventStoreAdapter,
  SQLiteEventStore,
} from 'src/app-hosts/linnya/adapters/persistence/event-store';
import { LinnyaRegisteredChildRunLifecycle } from '../childRunLifecycle';
import { SUBAGENT_GENERAL_AGENT_DEFINITION } from 'src/app-hosts/linnya/agent-registry/agents/subagent_general';
import { toChildRunAgentConfig } from '../childRunInvokerFactory';
import { SqliteSubrunTraceHistoryProjector } from 'src/app-hosts/linnya/adapters/persistence/subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import { readSubrunTrace } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { parseStoredRuntimeEvent } from 'src/app-hosts/linnya/adapters/persistence/event-store/functions/runtimeEventStorageCodec';

function buildEvent(params: {
  id: string;
  type: RuntimeEvent['type'];
  content?: string;
  output?: string;
}): RuntimeEvent {
  if (params.type === 'final_answer') {
    return {
      type: 'final_answer',
      id: params.id,
      conversation_id: 'conv_test',
      turn_id: 'turn_test',
      timestamp: Date.now(),
      version: 1,
      answer_id: `answer_${params.id}`,
      content: params.content ?? '',
      is_complete: true,
      completion_reason: 'terminal',
    };
  }

  if (params.type === 'tool_output') {
    return createToolOutputEvent(
      params.id,
      'conv_test',
      'turn_test',
      'noise_tool',
      'call_noise',
      {
        status: 'success',
        observation: params.output ?? '',
        data: {},
      }
    );
  }

  return {
    type: 'user_input',
    id: params.id,
    conversation_id: 'conv_test',
    turn_id: 'turn_test',
    timestamp: Date.now(),
    version: 1,
    source: 'user',
    content: params.content ?? '',
  };
}

type ParentToolContext = childRuns.ChildRunInvokeConfig['parentToolContext'];

/** 测试入口与生产 ToolContext admission 保持一致，避免用半成品上下文掩盖合同变化。 */
function createAdmittedParentToolContext(
  overrides: Partial<ParentToolContext> = {}
): ParentToolContext {
  return {
    ...overrides,
    conversationView: overrides.conversationView ?? {
      getWorkingHistoryEvents: () => [],
      getPersistedHistoryEvents: () => [],
    },
  };
}

function createConversationStore(): {
  db: Database.Database;
  host: SQLiteEventStore;
  adapter: LinnyaEventStoreAdapter;
} {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }

  const host = new SQLiteEventStore(db);
  return {
    db,
    host,
    adapter: new LinnyaEventStoreAdapter(db, host),
  };
}

function createProjectingRuntimeEventSink(
  publisher: execution.RuntimeEventPublisher,
  projector: SqliteSubrunTraceHistoryProjector,
): graph.RuntimeEventSink {
  return (event, source) => {
    const routed = publisher.publish(event, source);
    if (routed.type !== 'subrun_trace') {
      throw new Error('subrun trace test publisher returned a non-trace event');
    }
    projector.project(routed);
    return routed;
  };
}

function readReadySubrunTrace(params: {
  db: Database.Database;
  conversationId: string;
  parentToolCallId: string;
  subrunId: string;
}): readonly SubRunTraceEvent[] {
  const result = readSubrunTrace(
    params.db,
    params.conversationId,
    params.parentToolCallId,
    params.subrunId,
  );
  if (result.status !== 'ready') {
    throw new Error(`expected ready subrun trace, received ${result.status}`);
  }
  return result.events;
}

function createMemoryChildRunLifecycle(): {
  lifecycle: LinnyaRegisteredChildRunLifecycle;
  supervisor: runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>;
} {
  const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
    registryStore: new runSupervisor.MemoryRunRegistryStore(),
  });
  return {
    supervisor,
    lifecycle: new LinnyaRegisteredChildRunLifecycle({
      supervisor,
      eventStore: new graph.MemoryEventStore(),
      nextEventStoreId: graph.createMonotonicEventStoreIdFactory(() => Date.now()),
      costCollector: {
        snapshot: vi.fn(() => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 })),
      },
    }),
  };
}

function createDefaultResolvedAgent(): ResolvedRegisteredAgent {
  return {
    agentDefinition: {
      id: 'cancel-test-agent',
      promptKey: PromptKeys.DEFAULT,
      defaultMode: 'agent',
      description: 'cancel test agent',
      config: { maxSteps: 800 },
    },
    agentConfig: {
      id: 'cancel-test-agent',
      promptKey: PromptKeys.DEFAULT,
    },
  };
}

interface PersistedRuntimeEventRow {
  readonly id: string;
  readonly type: string;
  readonly payload: string;
  readonly ts: number;
  readonly run_id: string;
  readonly conversation_id: string;
  readonly parent_run_id: string | null;
}

function readPersistedRuntimeEvents(db: Database.Database, runId: string): RoutedRuntimeEvent[] {
  const rows = db
    .prepare<unknown[], PersistedRuntimeEventRow>(
      `
    SELECT
      e.id,
      e.type,
      e.payload,
      e.ts,
      e.run_id,
      r.conversation_id,
      r.parent_run_id
    FROM events e
    JOIN runs r ON r.id = e.run_id
    WHERE e.run_id = ?
    ORDER BY e.rowid ASC
  `
    )
    .all(runId);

  return rows.map(row => parseStoredRuntimeEvent(row.payload, {
    eventId: row.id,
    eventType: row.type,
    conversationId: row.conversation_id,
    runId: row.run_id,
    parentRunId: row.parent_run_id,
    timestamp: row.ts,
  }));
}

describe('RegisteredChildRunInvoker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应只把可见消息注入 seed history，并显式下发 trace/execution policy', async () => {
    const invoke = vi
      .fn<(params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>>()
      .mockResolvedValue({
        success: true,
        subrunId: 'child-visible-history',
        finalAnswer: 'child ok',
        events: [],
        stepCount: 3,
      });
    const resolvedAgent: ResolvedRegisteredAgent = {
      agentDefinition: {
        id: 'agent_1',
        promptKey: PromptKeys.DEFAULT,
        defaultMode: 'agent',
        description: 'x',
        config: { maxSteps: 800 },
      },
      agentConfig: {
        id: 'agent_1',
        promptKey: PromptKeys.DEFAULT,
      },
    };

    const createSubRunTracePublisher = vi.fn(() => ({ publish: vi.fn() }));
    const releaseAgentRunBarrier = vi.fn();
    const endAgentRun = vi.fn().mockResolvedValue({ release: releaseAgentRunBarrier });
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => resolvedAgent),
      },
      childRunInvoker: { invoke },
      lifecycle: createMemoryChildRunLifecycle().lifecycle,
      commandAgentRunLifecycle: { endAgentRun },
    });

    await invoker.invoke({
      promptKey: PromptKeys.DEFAULT,
      userMessage: '执行子任务',
      parentToolContext: createAdmittedParentToolContext({
        conversationId: 'conv-parent-context',
        runId: RunIdSchema.parse('parent-run-1'),
        parentToolCallId: ToolCallIdSchema.parse('ptc_1'),
        createSubRunTracePublisher,
        abortSignal: new AbortController().signal,
        conversationView: {
          getWorkingHistoryEvents: () => [
            buildEvent({ id: 'u_old', type: 'user_input', content: '更早问题' }),
            buildEvent({ id: 'tool_noise', type: 'tool_output', output: '噪音' }),
            buildEvent({ id: 'u_recent', type: 'user_input', content: '最近问题' }),
            buildEvent({ id: 'a_recent', type: 'final_answer', content: '最近回答' }),
          ],
          getPersistedHistoryEvents: () => [],
        },
      }),
      historyPolicy: { inheritTurns: 1 },
      tracePolicy: {
        subrunId: 'subrun_child_1',
        source: 'tool:test',
        metadata: { suite: 'child-run' },
      },
      executionPolicy: {
        conversationId: 'conv-explicit-child',
        maxSteps: 9,
      },
    });

    expect(createSubRunTracePublisher).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    const arg = invoke.mock.calls[0]?.[0];
    expect(arg?.seedHistoryEvents?.map(event => event.type)).toEqual([
      'user_input',
      'final_answer',
    ]);
    expect(arg?.maxSteps).toBe(9);
    expect(arg?.conversationId).toBe('conv-explicit-child');
    expect(arg?.runId).toBe('subrun_child_1');
    expect(arg?.parentRunId).toBe('parent-run-1');
    expect(arg?.runtimeEventSink).toBeTypeOf('function');
    expect(arg?.runtimeEventCommitPort).toBeTypeOf('function');
    const summary = createHistorySummaryEvent(
      'summary_registered_child',
      'conv-explicit-child',
      'turn_registered_child',
      'checkpoint',
      ['old_message'],
      1,
      1,
    );
    await expect(
      arg?.runtimeEventCommitPort?.(summary, 'registeredSubagentInvoker.test')
    ).resolves.toBeUndefined();
    expect(endAgentRun).toHaveBeenCalledOnce();
    expect(endAgentRun).toHaveBeenCalledWith({
      conversationId: 'conv-explicit-child',
      agentRunId: 'subrun_child_1',
    });
    expect(releaseAgentRunBarrier).toHaveBeenCalledOnce();
  });

  it('调用前已取消时应保留 cancelled 结果，并把 child lifecycle 记为取消', async () => {
    const abortController = new AbortController();
    abortController.abort('cancelled before child invocation');
    const childRunId = 'subrun_cancelled_before';
    const invoke = vi.fn<
      (params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>
    >(async params => {
      expect(params.abortSignal?.aborted).toBe(true);
      expect(params.maxSteps).toBe(800);
      return {
        runId: RunIdSchema.parse(childRunId),
        parentRunId: RunIdSchema.parse('parent-run-cancelled-before'),
        subrunId: childRunId,
        success: false,
        cancelled: true,
        error: 'cancelled before child invocation',
        events: [],
        stepCount: 0,
      };
    });
    const { lifecycle, supervisor } = createMemoryChildRunLifecycle();
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: { resolveByPromptKey: vi.fn(() => createDefaultResolvedAgent()) },
      childRunInvoker: { invoke },
      lifecycle,
    });

    const result = await invoker.invoke({
      promptKey: PromptKeys.DEFAULT,
      userMessage: '执行已取消的子任务',
      parentToolContext: createAdmittedParentToolContext({
        conversationId: 'conv-cancelled-before',
        runId: RunIdSchema.parse('parent-run-cancelled-before'),
      }),
      tracePolicy: { subrunId: childRunId },
      executionPolicy: { abortSignal: abortController.signal },
    });

    expect(result).toMatchObject({
      subrunId: childRunId,
      success: false,
      cancelled: true,
      error: 'cancelled before child invocation',
    });
    await expect(supervisor.peek(RunIdSchema.parse(childRunId))).resolves.toMatchObject({
      status: 'cancelled',
      currentNode: 'cancelled',
      iterationsUsed: 0,
      errorIfAny: {
        errorCode: 'RUN_CANCELLED',
        message: 'cancelled before child invocation',
      },
    });
  });

  it('父 trace 投影失败时保留 child 事实并阻止 lifecycle 报告 completed', async () => {
    const childRunId = 'subrun_projection_failure';
    const parentRunId = RunIdSchema.parse('parent-run-projection-failure');
    const projectionError = new Error('parent trace unavailable');
    const invoke = vi.fn<
      (params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>
    >(async params => {
      const finalAnswer = params.runtimeEventSink(
        createFinalAnswerEvent(
          'answer-projection-failure',
          'conv-projection-failure',
          'turn-projection-failure',
          '已生成但父投影失败的答案',
          { completion_reason: 'terminal' }
        ),
        'RegisteredChildRunInvoker.test'
      );
      return {
        runId: RunIdSchema.parse(childRunId),
        parentRunId,
        subrunId: childRunId,
        success: true,
        finalAnswer: '已生成但父投影失败的答案',
        events: [finalAnswer],
        stepCount: 1,
      };
    });
    const { lifecycle, supervisor } = createMemoryChildRunLifecycle();
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: { resolveByPromptKey: vi.fn(() => createDefaultResolvedAgent()) },
      childRunInvoker: { invoke },
      lifecycle,
    });

    await expect(
      invoker.invoke({
        promptKey: PromptKeys.DEFAULT,
        userMessage: '执行会发生父投影失败的子任务',
        parentToolContext: createAdmittedParentToolContext({
          conversationId: 'conv-projection-failure',
          runId: RunIdSchema.parse(parentRunId),
          parentToolCallId: ToolCallIdSchema.parse('parent-call-projection-failure'),
          createSubRunTracePublisher: () => ({
            publish: () => {
              throw projectionError;
            },
          }),
        }),
        tracePolicy: { subrunId: childRunId },
      })
    ).rejects.toBe(projectionError);

    await expect(supervisor.peek(RunIdSchema.parse(childRunId))).resolves.toMatchObject({
      runId: childRunId,
      status: 'failed',
      errorIfAny: {
        errorCode: 'CHILD_RUN_FACT_PIPELINE_FAILED',
      },
    });
  });

  it('通过 supervisor 取消执行中的 child 时应中止真实执行，并返回 cancelled', async () => {
    const childRunId = 'subrun_cancelled_during';
    const invoke = vi.fn<
      (params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>
    >(async params => {
      const signal = params.abortSignal;
      if (!signal) {
        throw new Error('child lifecycle signal is required');
      }
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        runId: RunIdSchema.parse(childRunId),
        parentRunId: RunIdSchema.parse('parent-run-cancelled-during'),
        subrunId: childRunId,
        success: false,
        cancelled: true,
        error: 'cancelled during child invocation',
        events: [],
        stepCount: 2,
      };
    });
    const { lifecycle, supervisor } = createMemoryChildRunLifecycle();
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: { resolveByPromptKey: vi.fn(() => createDefaultResolvedAgent()) },
      childRunInvoker: { invoke },
      lifecycle,
    });

    const resultPromise = invoker.invoke({
      promptKey: PromptKeys.DEFAULT,
      userMessage: '执行中取消子任务',
      parentToolContext: createAdmittedParentToolContext({
        conversationId: 'conv-cancelled-during',
        runId: RunIdSchema.parse('parent-run-cancelled-during'),
      }),
      tracePolicy: { subrunId: childRunId },
    });
    await vi.waitFor(async () => {
      expect(await supervisor.peek(RunIdSchema.parse(childRunId))).toMatchObject({
        status: 'running',
      });
    });
    await supervisor.cancel(RunIdSchema.parse(childRunId), {
      reason: 'cancelled during child invocation',
      forceCleanup: false,
    });
    const result = await resultPromise;

    expect(result.cancelled).toBe(true);
    await expect(supervisor.peek(RunIdSchema.parse(childRunId))).resolves.toMatchObject({
      status: 'cancelled',
      currentNode: 'cancelled',
      iterationsUsed: 2,
    });
  });

  it('通用 subagent_general 应继承父 run 已选定的模型', async () => {
    const invoke = vi
      .fn<(params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>>()
      .mockResolvedValue({
        subrunId: 'subrun_inherit_parent',
        success: true,
        finalAnswer: 'child ok',
        events: [],
        stepCount: 1,
      });
    const resolvedAgent: ResolvedRegisteredAgent = {
      agentDefinition: SUBAGENT_GENERAL_AGENT_DEFINITION,
      agentConfig: toChildRunAgentConfig(SUBAGENT_GENERAL_AGENT_DEFINITION),
    };
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => resolvedAgent),
      },
      childRunInvoker: { invoke },
      lifecycle: createMemoryChildRunLifecycle().lifecycle,
    });

    await invoker.invoke({
      promptKey: PromptKeys.SUBAGENT_GENERAL,
      userMessage: '执行通用子任务',
      parentToolContext: createAdmittedParentToolContext({
        conversationId: 'conv-parent',
        runId: RunIdSchema.parse('parent-run'),
        modelId: 'parent-user-model',
      }),
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0].modelId).toBe('parent-user-model');
    expect(invoke.mock.calls[0]?.[0].agentConfig.modelPolicy).toBeUndefined();
  });

  it('通用 subagent_general 缺少父模型时应在启动 child run 前失败', async () => {
    const invoke =
      vi.fn<(params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>>();
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => ({
          agentDefinition: SUBAGENT_GENERAL_AGENT_DEFINITION,
          agentConfig: toChildRunAgentConfig(SUBAGENT_GENERAL_AGENT_DEFINITION),
        })),
      },
      childRunInvoker: { invoke },
      lifecycle: createMemoryChildRunLifecycle().lifecycle,
    });

    await expect(
      invoker.invoke({
        promptKey: PromptKeys.SUBAGENT_GENERAL,
        userMessage: '执行通用子任务',
        parentToolContext: createAdmittedParentToolContext({
          conversationId: 'conv-parent',
          runId: RunIdSchema.parse('parent-run'),
        }),
      })
    ).rejects.toThrow('requires parentToolContext.modelId');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fixed 子 agent 不应自动继承父模型', async () => {
    const invoke = vi
      .fn<(params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>>()
      .mockResolvedValue({
        success: true,
        subrunId: 'child-fixed-model',
        finalAnswer: 'child ok',
        events: [],
        stepCount: 1,
      });
    const resolvedAgent: ResolvedRegisteredAgent = {
      agentDefinition: {
        id: 'fixed-child',
        promptKey: PromptKeys.DEEP_SEARCH,
        defaultMode: 'agent',
        description: 'fixed child',
        config: {
          modelPolicy: { kind: 'fixed', modelId: 'fixed-child-model' },
        },
      },
      agentConfig: {
        id: 'fixed-child',
        promptKey: PromptKeys.DEEP_SEARCH,
        modelPolicy: { kind: 'fixed', modelId: 'fixed-child-model' },
      },
    };

    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => resolvedAgent),
      },
      childRunInvoker: { invoke },
      lifecycle: createMemoryChildRunLifecycle().lifecycle,
    });

    await invoker.invoke({
      promptKey: PromptKeys.DEEP_SEARCH,
      userMessage: '执行深度搜索',
      parentToolContext: createAdmittedParentToolContext({
        conversationId: 'conv-parent',
        runId: RunIdSchema.parse('parent-run'),
        modelId: 'parent-user-model',
      }),
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0].modelId).toBeUndefined();
  });

  it('显式 executionPolicy.modelId 应覆盖继承父模型策略', async () => {
    const invoke = vi
      .fn<(params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>>()
      .mockResolvedValue({
        success: true,
        subrunId: 'child-explicit-model',
        finalAnswer: 'child ok',
        events: [],
        stepCount: 1,
      });
    const resolvedAgent: ResolvedRegisteredAgent = {
      agentDefinition: {
        id: SUBAGENT_GENERAL_AGENT_DEFINITION.id,
        promptKey: PromptKeys.SUBAGENT_GENERAL,
        defaultMode: 'agent',
        description: 'inherited child',
        config: {
          modelPolicy: { kind: 'inherit_parent' },
        },
      },
      agentConfig: {
        id: SUBAGENT_GENERAL_AGENT_DEFINITION.id,
        promptKey: PromptKeys.SUBAGENT_GENERAL,
      },
    };

    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => resolvedAgent),
      },
      childRunInvoker: { invoke },
      lifecycle: createMemoryChildRunLifecycle().lifecycle,
    });

    await invoker.invoke({
      promptKey: PromptKeys.SUBAGENT_GENERAL,
      userMessage: '执行通用子任务',
      parentToolContext: createAdmittedParentToolContext({
        conversationId: 'conv-parent',
        runId: RunIdSchema.parse('parent-run'),
        modelId: 'parent-user-model',
      }),
      executionPolicy: {
        modelId: 'explicit-child-model',
      },
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0].modelId).toBe('explicit-child-model');
  });

  it('默认生命周期应先注册 child run，保证 EventStore-backed audit 可写入 SQLite', async () => {
    const { db, host, adapter } = createConversationStore();
    const conversationId = 'conv-child-run-audit';
    const parentRunId = 'turn-parent-run';
    const childRunId = 'subrun_child_sqlite_1';
    const seed = createUserInputEvent(
      'seed-child-run-audit',
      conversationId,
      'turn-seed',
      '父问题'
    );
    await host.ensureConversation(conversationId, [seed], undefined, 'agent');

    const registryStore = new SQLiteRunRegistryStore(db);
    const rootSupervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
      registryStore,
      auditPort: audit.createEventStoreAudit({ eventStore: adapter }),
    });
    await registryStore.save({
      runId: RunIdSchema.parse(parentRunId),
      conversationId,
      agentSpecId: 'parent-agent',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const costCollector: runSupervisor.RunCostCollector = {
      snapshot: vi.fn(() => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 })),
    };
    const contextBuilder: graph.GraphExecutorContextBuilder = {
      build: vi.fn<graph.GraphExecutorContextBuilder['build']>(async () => ({
        llmMessages: [{ role: 'user', content: 'child prompt' }],
      })),
    };
    const llmCaller = {
      callWithRetries: vi.fn(async () => ({ content: 'child ok' })),
    };
    const toolRuntime = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
      executeTool: vi.fn(),
    };
    const observationPreview: tools.ObservationPreviewPort = {
      truncateObservation: async ({ text }) => ({ truncated: false, preview: text }),
    };
    const graphAgentExecutor = new graph.GraphAgentExecutor({
      llmCaller,
      toolRuntime,
      contextBuilder,
      modelResolver: new llm.ModelResolver({
        modelCatalog: {
          getModelById: () => undefined,
          getModelsByCapability: () => [],
          getModelsByUIVisibility: () => [{ id: 'test-model', enabled: true }],
        },
      }),
      auditPort: audit.createEventStoreAudit({ eventStore: adapter }),
    });
    const childInvoker = new childRuns.ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'test-model') },
      createLlmNode: () => new graph.LlmNode({ reasoner: graphAgentExecutor }),
      toolRuntime,
      observationPreview,
      eventToMessageConverter: vi.fn(() => []),
      auditPort: audit.createEventStoreAudit({ eventStore: adapter }),
    });
    const resolvedAgent: ResolvedRegisteredAgent = {
      agentDefinition: {
        id: 'child-agent',
        promptKey: PromptKeys.DEFAULT,
        defaultMode: 'agent',
        description: 'child agent',
        config: {
          availableTools: [],
          modelPolicy: { kind: 'fixed', modelId: 'test-model' },
        },
      },
      agentConfig: {
        id: 'child-agent',
        promptKey: PromptKeys.DEFAULT,
        availableTools: [],
        modelPolicy: { kind: 'fixed', modelId: 'test-model' },
      },
    };
    const nextEventStoreId = graph.createMonotonicEventStoreIdFactory();
    const parentSequencer = new execution.EventSequencer(conversationId);
    const parentEventBus = new execution.EventBus(parentSequencer.getExecutionId());
    const parentPublisher = new execution.RuntimeEventPublisher(parentEventBus, parentSequencer, {
      run_id: RunIdSchema.parse(parentRunId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const subrunTraceHistoryProjector = new SqliteSubrunTraceHistoryProjector(db);
    const parentPersistence = new execution.EventBusEventPersistence({
      eventBus: parentEventBus,
      eventStore: adapter,
      nextEventStoreId,
    });
    parentPersistence.connect();
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => resolvedAgent),
      },
      childRunInvoker: childInvoker,
      lifecycle: new LinnyaRegisteredChildRunLifecycle({
        supervisor: rootSupervisor,
        eventStore: adapter,
        nextEventStoreId,
        costCollector,
      }),
    });

    const result = await invoker.invoke({
      promptKey: PromptKeys.DEFAULT,
      userMessage: '执行子任务',
      parentToolContext: createAdmittedParentToolContext({
        conversationId,
        turnId: 'turn-parent',
        runId: RunIdSchema.parse(parentRunId),
        parentToolCallId: ToolCallIdSchema.parse('parent-tool-call-1'),
        createSubRunTracePublisher: binding =>
          new childRunTrace.RuntimeEventSubRunTracePublisher({
            runtimeEventSink: createProjectingRuntimeEventSink(
              parentPublisher,
              subrunTraceHistoryProjector,
            ),
            conversationId,
            turnId: 'turn-parent',
            parentToolCallId: binding.parentToolCallId,
            subrunId: binding.subrunId,
            source: binding.source,
            metadata: binding.metadata,
          }),
      }),
      tracePolicy: {
        subrunId: childRunId,
      },
      executionPolicy: {
        maxSteps: 2,
      },
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBe(childRunId);
    await expect(rootSupervisor.peek(RunIdSchema.parse(childRunId))).resolves.toMatchObject({
      runId: childRunId,
      parentRunId,
      status: 'completed',
    });

    const childEvents = readPersistedRuntimeEvents(db, childRunId);
    const auditActions = childEvents.flatMap(event => (
      event.type === 'audit_envelope' ? [event.envelope] : []
    ));
    expect(auditActions.some(envelope => envelope.action === 'model.select')).toBe(true);
    expect(auditActions.some(envelope => envelope.action === 'run.transcript')).toBe(false);

    await parentPersistence.drain();
    const childFinalAnswer = childEvents.find(event => event.type === 'final_answer');
    expect(childFinalAnswer).toMatchObject({
      run_id: childRunId,
      parent_run_id: parentRunId,
      lane: 'child',
      visibility: 'parent-trace',
      content: 'child ok',
    });
    expect(readPersistedRuntimeEvents(db, parentRunId)).not.toContainEqual(
      expect.objectContaining({ type: 'subrun_trace' }),
    );
    const parentFinalTrace = readReadySubrunTrace({
      db,
      conversationId,
      parentToolCallId: 'parent-tool-call-1',
      subrunId: childRunId,
    }).find(event => event.kind === 'final_answer');
    expect(parentFinalTrace).toMatchObject({
      run_id: parentRunId,
      parent_tool_call_id: 'parent-tool-call-1',
      subrun_id: childRunId,
      source_event_id: childFinalAnswer?.id,
      content: 'child ok',
    });

    parentEventBus.close();
    host.close();
  });

  it('child 取消结算前应排空工具终态，并把同一事实投影到 parent trace', async () => {
    const { db, host, adapter } = createConversationStore();
    const conversationId = 'conv-child-cancelled-tool-drain';
    const parentRunId = RunIdSchema.parse('run-parent-child-cancelled-tool-drain');
    const childRunId = RunIdSchema.parse('subrun-child-cancelled-tool-drain');
    const parentToolCallId = 'call-parent-subagent-cancelled-tool-drain';
    const childToolCallId = 'call-child-inflight-cancelled-tool-drain';
    await host.ensureConversation(
      conversationId,
      [
        createUserInputEvent(
          'seed-child-cancelled-tool-drain',
          conversationId,
          'turn-parent-child-cancelled-tool-drain',
          '执行一个会在工具运行中取消的子任务'
        ),
      ],
      undefined,
      'agent'
    );

    const registryStore = new SQLiteRunRegistryStore(db);
    const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
      registryStore,
    });
    await registryStore.save({
      runId: RunIdSchema.parse(parentRunId),
      conversationId,
      agentSpecId: 'parent-agent',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const nextEventStoreId = graph.createMonotonicEventStoreIdFactory();
    const parentSequencer = new execution.EventSequencer(conversationId);
    const parentEventBus = new execution.EventBus(parentSequencer.getExecutionId());
    const parentPublisher = new execution.RuntimeEventPublisher(parentEventBus, parentSequencer, {
      run_id: RunIdSchema.parse(parentRunId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const subrunTraceHistoryProjector = new SqliteSubrunTraceHistoryProjector(db);
    const parentPersistence = new execution.EventBusEventPersistence({
      eventBus: parentEventBus,
      eventStore: adapter,
      nextEventStoreId,
    });
    parentPersistence.connect();

    const childRunInvoker: Pick<childRuns.ChildRunInvoker, 'invoke'> = {
      invoke: vi.fn(async (params: childRuns.ChildRunInvokeConfig) => {
        const turnId = 'turn-child-cancelled-tool-drain';
        const admittedArgs = { request: '执行会在取消前开始的 child 工具' };
        const decision = params.runtimeEventSink(
          createToolCallDecisionEvent(
            'event-child-tool-decision',
            conversationId,
            turnId,
            'generic_child_tool',
            childToolCallId,
            {
              args: admittedArgs,
              payload: {
                args: admittedArgs,
                tool_calls: [{
                  id: childToolCallId,
                  type: 'function',
                  function: {
                    name: 'generic_child_tool',
                    arguments: JSON.stringify(admittedArgs),
                  },
                }],
              },
            },
          ),
          'RegisteredChildRunInvoker.cancelled-tool-drain',
        );
        const started = params.runtimeEventSink(
          createToolProcessEvent(
            'event-child-tool-process-start',
            conversationId,
            turnId,
            'generic_child_tool',
            childToolCallId,
            {
              args: admittedArgs,
            },
          ),
          'RegisteredChildRunInvoker.cancelled-tool-drain'
        );
        const output = params.runtimeEventSink(
          createToolOutputEvent(
            'event-child-tool-output-cancelled',
            conversationId,
            turnId,
            'generic_child_tool',
            childToolCallId,
            {
              status: 'error',
              observation: 'cancelled during execution',
              error: 'cancelled during execution',
            }
          ),
          'RegisteredChildRunInvoker.cancelled-tool-drain'
        );
        return {
          runId: childRunId,
          parentRunId,
          subrunId: childRunId,
          success: false,
          cancelled: true,
          error: 'The user aborted a request.',
          events: [decision, started, output],
          stepCount: 1,
        };
      }),
    };
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: { resolveByPromptKey: vi.fn(() => createDefaultResolvedAgent()) },
      childRunInvoker,
      lifecycle: new LinnyaRegisteredChildRunLifecycle({
        supervisor,
        eventStore: adapter,
        nextEventStoreId,
        costCollector: {
          snapshot: vi.fn(() => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 })),
        },
      }),
    });

    const result = await invoker.invoke({
      promptKey: PromptKeys.DEFAULT,
      userMessage: '执行并取消子任务',
      parentToolContext: createAdmittedParentToolContext({
        conversationId,
        turnId: 'turn-parent-child-cancelled-tool-drain',
        runId: RunIdSchema.parse(parentRunId),
        parentToolCallId: ToolCallIdSchema.parse(parentToolCallId),
        createSubRunTracePublisher: binding =>
          new childRunTrace.RuntimeEventSubRunTracePublisher({
            runtimeEventSink: createProjectingRuntimeEventSink(
              parentPublisher,
              subrunTraceHistoryProjector,
            ),
            conversationId,
            turnId: 'turn-parent-child-cancelled-tool-drain',
            parentToolCallId: binding.parentToolCallId,
            subrunId: binding.subrunId,
            source: binding.source,
            metadata: binding.metadata,
          }),
      }),
      tracePolicy: {
        subrunId: childRunId,
      },
    });
    await parentPersistence.drain();

    const childOutput = readPersistedRuntimeEvents(db, childRunId).find(
      event => event.type === 'tool_output' && event.tool_call_id === childToolCallId
    );
    const parentTrace = readReadySubrunTrace({
      db,
      conversationId,
      parentToolCallId,
      subrunId: childRunId,
    });
    const parentDecisionTrace = parentTrace.find(event => event.kind === 'tool_call_decision');
    const parentOutputTrace = parentTrace.find(
      event => event.kind === 'tool_output' && event.tool_call_id === childToolCallId,
    );
    expect(result.cancelled).toBe(true);
    expect(childOutput).toMatchObject({
      type: 'tool_output',
      run_id: childRunId,
      parent_run_id: parentRunId,
      tool_call_id: childToolCallId,
      status: 'error',
    });
    expect(parentDecisionTrace).toMatchObject({
      kind: 'tool_call_decision',
      tool_calls: [{
        tool_call_id: childToolCallId,
        tool_name: 'generic_child_tool',
        args: { request: '执行会在取消前开始的 child 工具' },
      }],
    });
    expect(parentOutputTrace).toMatchObject({
      type: 'subrun_trace',
      run_id: parentRunId,
      parent_tool_call_id: parentToolCallId,
      subrun_id: childRunId,
      source_event_id: childOutput?.id,
      kind: 'tool_output',
      tool_call_id: childToolCallId,
      status: 'error',
    });
    await expect(supervisor.peek(RunIdSchema.parse(childRunId))).resolves.toMatchObject({
      status: 'cancelled',
      currentNode: 'cancelled',
      iterationsUsed: 1,
    });

    parentEventBus.close();
    host.close();
  });

  it('两个并发 child 产生相同正文时，各自的全局答案身份与父 trace 仍按 run 和工具绑定隔离', async () => {
    const { db, host, adapter } = createConversationStore();
    const conversationId = 'conv-concurrent-child-isolation';
    const parentRunId = RunIdSchema.parse('run-concurrent-child-parent');
    const childRunIds = ['subrun-concurrent-a', 'subrun-concurrent-b'] as const;
    const parentToolCallIds = ['parent-tool-call-a', 'parent-tool-call-b'] as const;
    const sharedAnswerText = '两个 child 可以产生完全相同的正文';
    const seed = createUserInputEvent(
      'seed-concurrent-child-isolation',
      conversationId,
      'turn-concurrent-child-parent',
      '并发执行两个子任务'
    );
    await host.ensureConversation(conversationId, [seed], undefined, 'agent');

    const registryStore = new SQLiteRunRegistryStore(db);
    const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
      registryStore,
    });
    await registryStore.save({
      runId: RunIdSchema.parse(parentRunId),
      conversationId,
      agentSpecId: 'parent-agent',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const nextEventStoreId = graph.createMonotonicEventStoreIdFactory();
    const parentSequencer = new execution.EventSequencer(conversationId);
    const parentEventBus = new execution.EventBus(parentSequencer.getExecutionId());
    const parentPublisher = new execution.RuntimeEventPublisher(parentEventBus, parentSequencer, {
      run_id: RunIdSchema.parse(parentRunId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const subrunTraceHistoryProjector = new SqliteSubrunTraceHistoryProjector(db);
    const parentPersistence = new execution.EventBusEventPersistence({
      eventBus: parentEventBus,
      eventStore: adapter,
      nextEventStoreId,
    });
    parentPersistence.connect();

    let publishedChunkCount = 0;
    let releaseTerminalEvents: (() => void) | undefined;
    const bothChunksPublished = new Promise<void>(resolve => {
      releaseTerminalEvents = resolve;
    });
    const childRunInvoker: Pick<childRuns.ChildRunInvoker, 'invoke'> = {
      invoke: vi.fn(async (params: childRuns.ChildRunInvokeConfig) => {
        const runId = params.runId;
        if (!runId) {
          throw new Error('concurrent child test requires a run id');
        }
        const turnId = `turn-${runId}`;
        const answerId = `answer-${runId}`;
        const chunk = params.runtimeEventSink(
          createFinalAnswerChunkEvent(
            `chunk-${runId}`,
            conversationId,
            turnId,
            answerId,
            0,
            sharedAnswerText,
            { is_last: true }
          ),
          'RegisteredChildRunInvoker.concurrent-test'
        );
        publishedChunkCount += 1;
        if (publishedChunkCount === childRunIds.length) {
          releaseTerminalEvents?.();
        }
        await bothChunksPublished;
        const terminal = params.runtimeEventSink(
          createFinalAnswerEvent(answerId, conversationId, turnId, sharedAnswerText, {
            completion_reason: 'terminal',
          }),
          'RegisteredChildRunInvoker.concurrent-test'
        );
        return {
          runId,
          parentRunId,
          subrunId: runId,
          success: true,
          finalAnswer: sharedAnswerText,
          events: [chunk, terminal],
          stepCount: 1,
        };
      }),
    };
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: { resolveByPromptKey: vi.fn(() => createDefaultResolvedAgent()) },
      childRunInvoker,
      lifecycle: new LinnyaRegisteredChildRunLifecycle({
        supervisor,
        eventStore: adapter,
        nextEventStoreId,
        costCollector: {
          snapshot: vi.fn(() => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 })),
        },
      }),
    });
    const parentToolContext = createAdmittedParentToolContext({
      conversationId,
      turnId: 'turn-concurrent-child-parent',
      runId: RunIdSchema.parse(parentRunId),
      createSubRunTracePublisher: binding =>
        new childRunTrace.RuntimeEventSubRunTracePublisher({
          runtimeEventSink: createProjectingRuntimeEventSink(
            parentPublisher,
            subrunTraceHistoryProjector,
          ),
          conversationId,
          turnId: 'turn-concurrent-child-parent',
          parentToolCallId: binding.parentToolCallId,
          subrunId: binding.subrunId,
          source: binding.source,
          metadata: binding.metadata,
        }),
    });

    const results = await Promise.all(
      childRunIds.map((subrunId, index) =>
        invoker.invoke({
          promptKey: PromptKeys.DEFAULT,
          userMessage: `执行并发子任务 ${index + 1}`,
          parentToolContext,
          tracePolicy: {
            parentToolCallId: ToolCallIdSchema.parse(parentToolCallIds[index]),
            subrunId,
          },
        })
      )
    );
    await parentPersistence.drain();

    expect(results.map(result => result.subrunId)).toEqual(childRunIds);
    for (const childRunId of childRunIds) {
      const answerId = `answer-${childRunId}`;
      const answerFacts = readPersistedRuntimeEvents(db, childRunId).filter(
        event => event.type === 'final_answer_chunk' || event.type === 'final_answer'
      );
      expect(answerFacts).toHaveLength(2);
      expect(answerFacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'final_answer_chunk',
            run_id: childRunId,
            parent_run_id: parentRunId,
            answer_id: answerId,
            seq: 0,
            content: sharedAnswerText,
          }),
          expect.objectContaining({
            type: 'final_answer',
            run_id: childRunId,
            parent_run_id: parentRunId,
            answer_id: answerId,
            content: sharedAnswerText,
          }),
        ])
      );
    }

    expect(readPersistedRuntimeEvents(db, parentRunId)).not.toContainEqual(
      expect.objectContaining({ type: 'subrun_trace' }),
    );
    for (const [index, childRunId] of childRunIds.entries()) {
      const traces = readReadySubrunTrace({
        db,
        conversationId,
        parentToolCallId: parentToolCallIds[index],
        subrunId: childRunId,
      });
      const childSourceIds = new Set(
        readPersistedRuntimeEvents(db, childRunId)
          .filter(event => event.type === 'final_answer')
          .map(event => event.id)
      );
      expect(traces).toHaveLength(1);
      expect(new Set(traces.map(trace => trace.source_event_id))).toEqual(childSourceIds);
      expect(traces.every(trace => trace.answer_id === `answer-${childRunId}`)).toBe(true);
    }

    parentEventBus.close();
    host.close();
  });

  it('默认生命周期应支持 child run 内部调用工具，并把审计写到注册时的父 conversation', async () => {
    const { db, host, adapter } = createConversationStore();
    const conversationId = 'conv-child-run-tool-audit';
    const parentRunId = 'turn-parent-run-tool';
    const childRunId = 'subrun_child_sqlite_tool_1';
    const seed = createUserInputEvent(
      'seed-child-run-tool-audit',
      conversationId,
      'turn-seed',
      '父问题'
    );
    await host.ensureConversation(conversationId, [seed], undefined, 'agent');

    const registryStore = new SQLiteRunRegistryStore(db);
    const rootSupervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
      registryStore,
      auditPort: audit.createEventStoreAudit({ eventStore: adapter }),
    });
    await registryStore.save({
      runId: RunIdSchema.parse(parentRunId),
      conversationId,
      agentSpecId: 'parent-agent',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const costCollector: runSupervisor.RunCostCollector = {
      snapshot: vi.fn(() => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 })),
    };
    const contextBuilder: graph.GraphExecutorContextBuilder = {
      build: vi.fn<graph.GraphExecutorContextBuilder['build']>(async () => ({
        llmMessages: [{ role: 'user', content: 'child prompt' }],
      })),
    };
    const llmCaller = {
      callWithRetries: vi
        .fn<llm.LlmCaller['callWithRetries']>()
        .mockResolvedValueOnce({
          content: '',
          tool_calls: [
            {
              id: 'call_child_probe',
              type: 'function',
              function: {
                name: 'child_probe_tool',
                arguments: '{"value":"hello"}',
              },
            },
          ],
        })
        .mockResolvedValueOnce({ content: 'child tool ok' }),
    };
    const childProbeParameters = {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'probe value' },
      },
    } satisfies tools.ToolParameterSchema;
    const childProbeSchema: tools.FunctionToolSchema = {
      type: 'function',
      function: {
        name: 'child_probe_tool',
        description: 'probe child tool audit path',
        parameters: childProbeParameters,
      },
    };
    const executeTool = vi.fn<tools.ToolRuntimePort['executeTool']>(async () => ({
      success: true,
      result: JSON.stringify({ observation: 'probe ok' }),
      durationMs: 1,
    }));
    const toolRuntime: tools.ToolRuntimePort = {
      getToolSchemas: vi.fn<tools.ToolRuntimePort['getToolSchemas']>(() => [childProbeSchema]),
      getToolDefinition: vi.fn<tools.ToolRuntimePort['getToolDefinition']>(() => ({
        parameters: childProbeParameters,
      })),
      executeTool,
    };
    const observationPreview: tools.ObservationPreviewPort = {
      truncateObservation: async ({ text }) => ({ truncated: false, preview: text }),
    };
    const graphAgentExecutor = new graph.GraphAgentExecutor({
      llmCaller,
      toolRuntime,
      contextBuilder,
      modelResolver: new llm.ModelResolver({
        modelCatalog: {
          getModelById: () => undefined,
          getModelsByCapability: () => [],
          getModelsByUIVisibility: () => [{ id: 'test-model', enabled: true }],
        },
      }),
      auditPort: audit.createEventStoreAudit({ eventStore: adapter }),
    });
    const childInvoker = new childRuns.ChildRunInvoker({
      modelResolver: { resolveModelId: vi.fn(() => 'test-model') },
      createLlmNode: () => new graph.LlmNode({ reasoner: graphAgentExecutor }),
      toolRuntime,
      observationPreview,
      eventToMessageConverter: vi.fn(() => []),
      auditPort: audit.createEventStoreAudit({ eventStore: adapter }),
    });
    const resolvedAgent: ResolvedRegisteredAgent = {
      agentDefinition: {
        id: 'child-agent-tool',
        promptKey: PromptKeys.DEFAULT,
        defaultMode: 'agent',
        description: 'child agent tool',
        config: {
          availableTools: ['child_probe_tool'],
          modelPolicy: { kind: 'fixed', modelId: 'test-model' },
        },
      },
      agentConfig: {
        id: 'child-agent-tool',
        promptKey: PromptKeys.DEFAULT,
        availableTools: ['child_probe_tool'],
        modelPolicy: { kind: 'fixed', modelId: 'test-model' },
      },
    };
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => resolvedAgent),
      },
      childRunInvoker: childInvoker,
      lifecycle: new LinnyaRegisteredChildRunLifecycle({
        supervisor: rootSupervisor,
        eventStore: adapter,
        nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
        costCollector,
      }),
    });

    const result = await invoker.invoke({
      promptKey: PromptKeys.DEFAULT,
      userMessage: '执行子任务并调用工具',
      parentToolContext: createAdmittedParentToolContext({
        conversationId,
        turnId: 'turn-parent-tool',
        runId: RunIdSchema.parse(parentRunId),
      }),
      tracePolicy: {
        subrunId: childRunId,
      },
      executionPolicy: {
        maxSteps: 5,
      },
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBe(childRunId);
    expect(executeTool).toHaveBeenCalledTimes(1);
    const toolContext = executeTool.mock.calls[0]?.[2];
    expect(toolContext?.conversationId).toBe(conversationId);
    expect(toolContext?.runId).toBe(childRunId);
    expect(toolContext?.parentRunId).toBe(parentRunId);
    await expect(rootSupervisor.peek(RunIdSchema.parse(childRunId))).resolves.toMatchObject({
      runId: childRunId,
      parentRunId,
      status: 'completed',
    });

    const childEvents = readPersistedRuntimeEvents(db, childRunId);
    const auditActions = childEvents.flatMap(event => (
      event.type === 'audit_envelope' ? [event.envelope] : []
    ));

    expect(childEvents.every(event => event.conversation_id === conversationId)).toBe(true);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'model.select',
          scope: expect.objectContaining({
            conversationId,
            runId: childRunId,
          }),
        }),
        expect.objectContaining({
          action: 'tool.allow',
          scope: expect.objectContaining({
            conversationId,
            runId: childRunId,
          }),
        }),
      ])
    );
    expect(auditActions.some(envelope => envelope.action === 'run.transcript')).toBe(false);

    host.close();
  });

  it('默认生命周期缺少父 run 信息时应早失败，避免跳过注册后写坏审计链路', async () => {
    const invoke =
      vi.fn<(params: childRuns.ChildRunInvokeConfig) => Promise<childRuns.ChildRunInvokeResult>>();
    const resolvedAgent: ResolvedRegisteredAgent = {
      agentDefinition: {
        id: 'agent_missing_parent',
        promptKey: PromptKeys.DEFAULT,
        defaultMode: 'agent',
        description: 'x',
      },
      agentConfig: {
        id: 'agent_missing_parent',
        promptKey: PromptKeys.DEFAULT,
      },
    };
    const lifecycle = new LinnyaRegisteredChildRunLifecycle({
      supervisor: new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
        registryStore: new runSupervisor.MemoryRunRegistryStore(),
      }),
      eventStore: new graph.MemoryEventStore(),
      nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
      costCollector: {
        snapshot: vi.fn(() => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 })),
      },
    });
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: vi.fn(() => resolvedAgent),
      },
      childRunInvoker: { invoke },
      lifecycle,
    });

    await expect(
      invoker.invoke({
        promptKey: PromptKeys.DEFAULT,
        userMessage: '执行子任务',
        parentToolContext: createAdmittedParentToolContext({
          conversationId: 'conv-missing-parent-run',
        }),
        tracePolicy: {
          subrunId: 'subrun_missing_parent',
        },
      })
    ).rejects.toThrow('parentToolContext.runId or executionPolicy.parentRunId is required');
    expect(invoke).not.toHaveBeenCalled();
  });
});
