import { describe, expect, it } from 'vitest';

import type { AgentInvocationRequest } from '../../ports';
import {
  createFinalAnswerEvent,
  createToolCallDecisionEvent,
  type RoutedRuntimeEvent,
  type SerializableJsonValue,
  type RuntimeEvent,
  RunIdSchema,
  ToolCallIdSchema,
} from '../../contracts';
import type {
  EngineState,
  GraphNode,
  GraphLoopHarnessOptions,
  ToolExecutionResult,
  ToolRuntimePort,
  runSupervisor,
} from '../../runtime-kernel';
import { createGraphLoopHarness, execution, events as runtimeEvents } from '../../runtime-kernel';
import {
  assertRunInvariants,
  createRunSupervisorHarness,
  createScriptedInferenceHarness,
  createToolContextFixture,
  type RunInvariantId,
  validateRunInvariants,
} from '../index';

type RunExecutionContext = runSupervisor.RunExecutionContext<AgentInvocationRequest>;
type RunExecutorPort = runSupervisor.RunExecutorPort<AgentInvocationRequest>;
type RunOutcome = runSupervisor.RunOutcome;

interface ScriptedLlmDecision {
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, SerializableJsonValue>;
  };
  finalAnswer?: string;
}

interface GraphRunFixtures {
  events: RoutedRuntimeEvent[];
  executor: RunExecutorPort;
}

function createRequest(overrides: Partial<AgentInvocationRequest> = {}): AgentInvocationRequest {
  return {
    query: '请完成 supervisor graph loop 契约测试',
    promptKey: 'supervisor-graph-loop-contract',
    model_id: 'contract-model',
    enableTools: true,
    availableTools: ['mock_tool'],
    maxSteps: 8,
    ...overrides,
  };
}

function createObservationPreviewStub(): GraphLoopHarnessOptions['observationPreview'] {
  return {
    async truncateObservation(params) {
      return {
        truncated: false,
        preview: params.text,
      };
    },
  };
}

function createMockToolRuntime(): ToolRuntimePort {
  return {
    getToolSchemas() {
      return [];
    },
    getToolDefinition(toolName) {
      return {
        name: toolName,
        description: `mock tool ${toolName}`,
        parameters: { type: 'object', properties: {}, required: [] },
      } as ReturnType<ToolRuntimePort['getToolDefinition']>;
    },
    async executeTool(_toolName, args): Promise<ToolExecutionResult> {
      return {
        success: true,
        result: JSON.stringify({
          data: { query: args.query ?? null },
          observation: `mock result: ${String(args.query ?? '')}`,
        }),
        durationMs: 1,
      };
    },
  };
}

function createScriptedLlmNode(params: { decisions: readonly ScriptedLlmDecision[] }): GraphNode {
  let cursor = 0;

  return {
    id: 'llm',
    async run(state: EngineState) {
      const decision = params.decisions[cursor];
      cursor += 1;
      if (!decision) {
        throw new Error(`[supervisorGraphLoop] scripted llm exhausted at call ${cursor}`);
      }

      const local = state.local ?? {};
      const conversationId = typeof local.conversationId === 'string' ? local.conversationId : '';
      const turnId = typeof local.turnId === 'string' ? local.turnId : `turn_${Date.now()}`;
      const runtimeEventSink = local.runtimeEventSink;
      if (!runtimeEventSink) {
        throw new Error('supervisor graph loop requires runtime event admission');
      }

      if (decision.toolCall) {
        const toolCall = {
          id: ToolCallIdSchema.parse(decision.toolCall.id),
          type: 'function' as const,
          function: {
            name: decision.toolCall.name,
            arguments: JSON.stringify(decision.toolCall.args),
          },
        };
        const event = createToolCallDecisionEvent(
          `decision_${decision.toolCall.id}`,
          conversationId,
          turnId,
          decision.toolCall.name,
          decision.toolCall.id,
          {
            args: decision.toolCall.args,
            payload: {
              args: decision.toolCall.args,
              tool_calls: [toolCall],
            },
            meta: {
              tool_call_ids: [decision.toolCall.id],
              tool_batch_size: 1,
            },
          }
        );
        const published = runtimeEventSink(
          event,
          'supervisorGraphLoop.scriptedLlm.tool_call_decision'
        );
        state.local = {
          ...local,
          history: [...(Array.isArray(local.history) ? local.history : []), published],
          pendingToolCalls: [toolCall],
        };
        return { kind: 'route', nextNodeId: 'tool', events: [published] };
      }

      if (typeof decision.finalAnswer === 'string') {
        const event = createFinalAnswerEvent(
          `answer_segment_${turnId}`,
          conversationId,
          turnId,
          decision.finalAnswer,
          { completion_reason: 'terminal' }
        );
        const published = runtimeEventSink(event, 'supervisorGraphLoop.scriptedLlm.final_answer');
        state.local = {
          ...local,
          finalAnswer: decision.finalAnswer,
        };
        return { kind: 'route', nextNodeId: 'answer', events: [published] };
      }

      return { kind: 'yield', events: [] };
    },
  };
}

function createGraphRunFixtures(params: {
  publish: (event: RoutedRuntimeEvent, seq?: number) => void;
  persist: (event: RoutedRuntimeEvent, eventStoreId?: string) => Promise<void>;
  decisions?: readonly ScriptedLlmDecision[];
}): GraphRunFixtures {
  const events: RoutedRuntimeEvent[] = [];

  const persistDurableEvents = async (
    capturedEvents: readonly RoutedRuntimeEvent[]
  ): Promise<void> => {
    for (const [index, event] of capturedEvents.entries()) {
      if (runtimeEvents.shouldPersistRuntimeEvent(event)) {
        await params.persist(event, String(index + 1).padStart(13, '0'));
      }
    }
  };

  const executor: RunExecutorPort = {
    async execute(context): Promise<RunOutcome> {
      const toolRuntime = createMockToolRuntime();
      const aiHarness = createScriptedInferenceHarness([]);
      const toolContext = createToolContextFixture({
        conversationId: context.conversationId,
        turnId: context.runId,
        patch: {
          runId: context.runId,
          parentRunId: context.parentRunId,
          abortSignal: context.signal,
        },
      });
      const sequencer = new execution.EventSequencer(context.conversationId);
      const eventBus = new execution.EventBus(sequencer.getExecutionId());
      const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
        run_id: context.runId,
        ...(context.parentRunId ? { parent_run_id: context.parentRunId } : {}),
        lane: context.parentRunId ? 'child' : 'foreground',
        visibility: context.parentRunId ? 'parent-trace' : 'conversation',
      });
      eventBus.on('event', envelope => {
        params.publish(envelope.payload, envelope.seq);
        events.push(envelope.payload);
      });

      const graphLoop = createGraphLoopHarness({
        conversationId: context.conversationId,
        turnId: context.runId,
        query: context.request.query,
        request: context.request,
        toolContext,
        llmCaller: aiHarness.getLlmCaller(),
        toolRuntime,
        observationPreview: createObservationPreviewStub(),
        createLlmNode: () =>
          createScriptedLlmNode({
            decisions: params.decisions ?? [
              { toolCall: { id: 'call_contract_1', name: 'mock_tool', args: { query: 'hello' } } },
              { finalAnswer: '工具结果已合成最终答案' },
            ],
          }),
        signal: context.signal,
        maxSteps: context.request.maxSteps ?? 8,
        runtimeEventSink: (event, source) => publisher.publish(event, source),
      });

      try {
        const result = await graphLoop.run();
        await persistDurableEvents(events);
        return {
          runId: context.runId,
          status: 'completed',
          completedAt: Date.now(),
          currentNode: result.checkpointNodeId,
          iterationsUsed: result.stepCount,
        };
      } finally {
        eventBus.close();
      }
    },
  };

  return { events, executor };
}

async function assertSelectedRunInvariants(params: {
  rootRunId: string;
  harness: ReturnType<typeof createRunSupervisorHarness<AgentInvocationRequest>>;
  events: readonly RuntimeEvent[];
  signal?: AbortSignal;
  terminalOutcomes?: readonly RunOutcome[];
  enabled: readonly RunInvariantId[];
}): Promise<void> {
  const report = await validateRunInvariants(
    {
      rootRunId: params.rootRunId,
      runRecords: await params.harness.getRegisteredRuns(),
      events: params.events,
      persistedEvents: await params.harness.eventStore.range('conv-supervisor-graph'),
      telemetryEvents: params.harness.telemetry.getEvents(),
      auditEnvelopes: params.harness.audit.getEnvelopes(),
      terminalOutcomes: params.terminalOutcomes,
      inFlightRunIds: [],
      signal: params.signal,
      getCost: runId => params.harness.telemetry.costCollector.snapshot(RunIdSchema.parse(runId)),
    },
    {
      enabled: params.enabled,
    }
  );

  assertRunInvariants(report);
}

describe('supervisor × graphLoop end-to-end contract', () => {
  it('registerRun 路径应跑通 LLM → Tool → LLM → Answer 并满足核心 run invariants', async () => {
    const harness = createRunSupervisorHarness<AgentInvocationRequest>();
    const fixtures = createGraphRunFixtures({
      publish: harness.publish,
      persist: harness.persist,
    });
    const handle = await harness.registerRun({
      runId: 'run-supervisor-graph-complete',
      conversationId: 'conv-supervisor-graph',
      request: createRequest(),
    });

    await handle.markRunning({ currentNode: 'user' });
    const outcome = await fixtures.executor.execute({
      runId: handle.runId,
      conversationId: 'conv-supervisor-graph',
      agentSpec: await handle.spec(),
      request: await handle.request(),
      signal: handle.signal,
      eventBus: harness.eventBus,
      eventStore: harness.eventStore,
      costCollector: harness.telemetry.costCollector,
    });
    await handle.markCompleted({
      currentNode: outcome?.currentNode,
      iterationsUsed: outcome?.iterationsUsed,
    });

    await assertSelectedRunInvariants({
      rootRunId: handle.runId,
      harness,
      events: fixtures.events,
      signal: handle.signal,
      enabled: [
        'I1_FINAL_STATUS',
        'I3_TOOL_CALL_OUTPUT_PAIR',
        'I6_EVENT_RUN_IDENTITY',
        'I7_PERSISTED_EVENT_ORDER',
        'I8_NO_ACTION_EVENT',
        'I10_TELEMETRY_RUN_REGISTERED',
        'I11_COST_NON_NEGATIVE',
        'I12_AUDIT_RUN_REGISTERED',
      ],
    });
    expect(fixtures.events.map(event => event.type)).toEqual(
      expect.arrayContaining(['tool_call_decision', 'tool_output', 'final_answer'])
    );

    harness.restore();
  });

  it('cancel 路径应让 AbortSignal、RunRecord 与 run.cancel audit 保持一致', async () => {
    const harness = createRunSupervisorHarness<AgentInvocationRequest>();
    const fixtures = createGraphRunFixtures({
      publish: harness.publish,
      persist: harness.persist,
    });
    const handle = await harness.registerRun({
      runId: 'run-supervisor-graph-cancel',
      conversationId: 'conv-supervisor-graph',
      request: createRequest(),
    });

    await handle.markRunning({ currentNode: 'tool' });
    await handle.cancel({ reason: 'user requested cancellation', forceCleanup: true });
    await expect(
      fixtures.executor.execute({
        runId: handle.runId,
        conversationId: 'conv-supervisor-graph',
        agentSpec: await handle.spec(),
        request: await handle.request(),
        signal: handle.signal,
        eventBus: harness.eventBus,
        eventStore: harness.eventStore,
        costCollector: harness.telemetry.costCollector,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });

    await assertSelectedRunInvariants({
      rootRunId: handle.runId,
      harness,
      events: fixtures.events,
      signal: handle.signal,
      enabled: [
        'I1_FINAL_STATUS',
        'I5_CANCEL_AUDIT',
        'I9_CANCEL_SIGNAL_STATUS',
        'I10_TELEMETRY_RUN_REGISTERED',
        'I11_COST_NON_NEGATIVE',
        'I12_AUDIT_RUN_REGISTERED',
      ],
    });

    harness.restore();
  });

  it('spawnDetached 路径应由 supervisor executor 驱动 graphLoop 并缓存终态 outcome', async () => {
    let fixtures: GraphRunFixtures | undefined;
    const harness = createRunSupervisorHarness<AgentInvocationRequest>({
      executor: {
        async execute(context) {
          fixtures = createGraphRunFixtures({
            publish: harness.publish,
            persist: harness.persist,
          });
          return fixtures.executor.execute(context);
        },
      },
    });

    const handle = await harness.spawnDetached({
      runId: 'run-supervisor-graph-detached',
      conversationId: 'conv-supervisor-graph',
      request: createRequest(),
    });
    const terminal = await harness.supervisor.waitForTerminal(handle.runId);
    const capturedEvents = fixtures?.events ?? [];

    expect(terminal).toMatchObject({
      runId: handle.runId,
      status: 'completed',
      currentNode: 'answer',
    });
    await assertSelectedRunInvariants({
      rootRunId: handle.runId,
      harness,
      events: capturedEvents,
      terminalOutcomes: [terminal],
      signal: handle.signal,
      enabled: [
        'I1_FINAL_STATUS',
        'I3_TOOL_CALL_OUTPUT_PAIR',
        'I6_EVENT_RUN_IDENTITY',
        'I7_PERSISTED_EVENT_ORDER',
        'I8_NO_ACTION_EVENT',
        'I10_TELEMETRY_RUN_REGISTERED',
        'I11_COST_NON_NEGATIVE',
        'I12_AUDIT_RUN_REGISTERED',
        'I14_DETACHED_TERMINAL_OUTCOME',
        'I15_DRAIN_NO_INFLIGHT',
      ],
    });

    harness.restore();
  });
});
