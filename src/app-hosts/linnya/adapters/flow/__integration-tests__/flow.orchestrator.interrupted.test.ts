import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConversationNextRequest } from '@app/schemas';
import { FlowOrchestrator } from 'src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import { FlowIncomingEventPreparer } from 'src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import {
  createFinalAnswerChunkEvent,
  createFinalAnswerEvent,
  createRunExecutionMetricsEvent,
  createToolOutputEvent,
  createToolProcessEvent,
} from 'linnkit/contracts';
import type { FlowExecutionResult } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import type {
  FlowAgentRunExecution,
  FlowAgentRunRequest,
} from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import { createDirectFlowConversationAdmissionPort } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDirectFlowConversationAdmissionPort';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import {
  createFlowIntegrationRuntimePersistence,
  InMemoryFlowEventStore,
} from 'src/app-hosts/linnya/testkit/agent-harness/flowIntegrationHarness';
import { RuntimeEvent as RuntimeEventSchema } from 'linnkit/contracts';

interface Latch {
  readonly promise: Promise<void>;
  release(): void;
}

function createLatch(): Latch {
  let release = (): void => {
    throw new Error('latch was released before initialization');
  };
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

function createRunExecution(
  runRequest: FlowAgentRunRequest,
  result: FlowExecutionResult
): FlowAgentRunExecution {
  const resultPromise = (async (): Promise<FlowExecutionResult> => {
    for (const event of result.events) {
      runRequest.hostPorts.runtimeEventSink(event, 'FlowOrchestratorTestRunner');
    }
    const interrupted = result.terminationReason === 'interrupted';
    runRequest.hostPorts.runtimeEventSink(
      createRunExecutionMetricsEvent(
        `metrics_${runRequest.hostPorts.sequencer.getExecutionId()}`,
        runRequest.conversationId,
        runRequest.turnId,
        {
          execution_id: runRequest.hostPorts.sequencer.getExecutionId(),
          outcome: interrupted ? 'cancelled' : 'completed',
          duration_ms: 1,
          user_message_id: runRequest.newEvents.find(event => event.type === 'user_input')?.id,
        }
      ),
      'FlowOrchestratorTestRunner.metrics'
    );
    await runRequest.hostPorts.drainPersistence();
    if (interrupted) {
      await runRequest.runHandle.cancel({ reason: 'interrupted', forceCleanup: false });
    } else {
      await runRequest.runHandle.markCompleted({ iterationsUsed: result.stepCount });
    }
    return { ...result, events: runRequest.hostPorts.getGeneratedEvents() };
  })();
  return {
    handle: runRequest.runHandle,
    result: resultPromise,
    then: (onfulfilled, onrejected) => resultPromise.then(onfulfilled, onrejected),
  };
}

function createPersistenceHarness(): {
  eventStore: InMemoryFlowEventStore;
  historyRepository: HistoryRepository;
  historyHandler: HistoryHandlerService;
  coordinator: EventPersistenceCoordinator;
  runtimePersistence: ReturnType<typeof createFlowIntegrationRuntimePersistence>;
} {
  const eventStore = new InMemoryFlowEventStore();
  const historyRepository = new HistoryRepository(eventStore);
  const historyHandler = new HistoryHandlerService(createFlowHistoryAccessPort(historyRepository));
  return {
    coordinator: new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    }),
    eventStore,
    historyRepository,
    historyHandler,
    runtimePersistence: createFlowIntegrationRuntimePersistence(eventStore),
  };
}

describe('FlowOrchestrator interrupted termination', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
    resetAgentRuntimeSingletonsForTest();
  });

  it('detached start 在 durable input 与 run ownership 后返回，调用 transport 结束不取消后台执行', async () => {
    const conversationId = 'conv_detached_host_owned';
    const turnId = 'turn_detached_host_owned';
    const releaseExecution = createLatch();
    const executionCompleted = createLatch();
    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest): FlowAgentRunExecution => {
        const result = (async (): Promise<FlowExecutionResult> => {
          await runRequest.runHandle.markRunning({ currentNode: 'llm' });
          await releaseExecution.promise;
          await runRequest.hostPorts.drainPersistence();
          await runRequest.runHandle.markCompleted({ currentNode: 'llm', iterationsUsed: 1 });
          executionCompleted.release();
          return {
            conversation_id: conversationId,
            events: runRequest.hostPorts.getGeneratedEvents(),
            stepCount: 1,
            terminationReason: 'complete',
          };
        })();
        return {
          handle: runRequest.runHandle,
          result,
          then: (onfulfilled, onrejected) => result.then(onfulfilled, onrejected),
        };
      }),
      discardCheckpoint: vi.fn(async () => undefined),
    };
    const persistence = createPersistenceHarness();
    const orchestrator = new FlowOrchestrator(
      persistence.historyHandler,
      agentRunner,
      persistence.coordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      persistence.runtimePersistence,
    );

    const receipt = await orchestrator.nextDetached({
      conversation_id: conversationId,
      new_events: [{
        type: 'user_input',
        id: 'user_detached_host_owned',
        content: '后台继续执行',
        timestamp: Date.now(),
        source: 'user',
        turn_id: turnId,
      }],
      options: { model_id: 'test-model' },
    });

    expect(receipt).toMatchObject({
      conversationId,
      incomingEventIds: ['user_detached_host_owned'],
      turnId,
      agentId: 'default',
    });
    expect((await persistence.historyRepository.readFrom(conversationId, 0)).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'user_input', id: 'user_detached_host_owned' }),
      ]),
    );
    expect((await persistence.runtimePersistence.supervisor.peek(receipt.runId))?.status)
      .toBe('pending');

    releaseExecution.release();
    await executionCompleted.promise;
    await expect(persistence.runtimePersistence.supervisor.peek(receipt.runId)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('persists partial assistant output and separates cancelled status from transport completion', async () => {
    const partialAnswer = RuntimeEventSchema.parse(
      createFinalAnswerEvent(
        'answer_interrupt_1',
        'conv_interrupt_1',
        'turn_interrupt_1',
        'partial answer',
        {
          completion_reason: 'interrupted',
          meta: { partial: true, chunk_count: 3 },
        }
      )
    );

    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest) =>
        createRunExecution(runRequest, {
          conversation_id: 'conv_interrupt_1',
          events: [partialAnswer],
          stepCount: 0,
          terminationReason: 'interrupted',
        })
      ),
      discardCheckpoint: vi.fn(async () => undefined),
    };

    const persistence = createPersistenceHarness();

    const orchestrator = new FlowOrchestrator(
      persistence.historyHandler,
      agentRunner,
      persistence.coordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      persistence.runtimePersistence
    );

    const sseSink = vi.fn();
    const request: ConversationNextRequest = {
      conversation_id: 'conv_interrupt_1',
      new_events: [
        {
          type: 'user_input',
          id: 'user_evt_1',
          content: 'stop midway',
          timestamp: Date.now(),
          source: 'user',
          turn_id: 'turn_interrupt_1',
        },
      ],
      options: {
        model_id: 'test-model',
      },
    };

    const result = await orchestrator.next(request, sseSink);
    const foregroundRunId = agentRunner.run.mock.calls[0]?.[0].runHandle.runId;

    expect(result.terminationReason).toBe('interrupted');
    expect(foregroundRunId).toEqual(expect.any(String));
    expect(foregroundRunId).not.toBe('turn_interrupt_1');
    const history = await persistence.historyRepository.readFrom('conv_interrupt_1', 0);
    expect(history.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user_input',
          id: 'user_evt_1',
        }),
        expect.objectContaining({
          type: 'final_answer',
          content: 'partial answer',
          is_complete: false,
        }),
        expect.objectContaining({
          type: 'run_execution_metrics',
          outcome: 'cancelled',
        }),
      ])
    );

    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'user_input_committed',
        id: 'user_evt_1',
        operation: 'append',
        raw_content: 'stop midway',
      })
    );
    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_execution_metrics',
        conversation_id: 'conv_interrupt_1',
        turn_id: 'turn_interrupt_1',
        outcome: 'cancelled',
        user_message_id: 'user_evt_1',
      })
    );
    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_status',
        status: 'cancelled',
      })
    );
    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transport_end',
        reason: 'interrupted',
      })
    );
  });

  it('cancel API 应等待 execution 事实 drain 完成后再允许 Renderer 重读', async () => {
    const conversationId = 'conv_cancel_completion_barrier';
    const turnId = 'turn_cancel_completion_barrier';
    const toolCallId = 'call_cancel_completion_barrier';
    const executionStarted = createLatch();
    const abortObserved = createLatch();
    const releaseSettlement = createLatch();
    let capturedRunRequest: FlowAgentRunRequest | undefined;

    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest): FlowAgentRunExecution => {
        capturedRunRequest = runRequest;
        const result = (async (): Promise<FlowExecutionResult> => {
          executionStarted.release();
          await new Promise<void>(resolve => {
            runRequest.runHandle.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          abortObserved.release();
          await releaseSettlement.promise;
          runRequest.hostPorts.runtimeEventSink(
            createToolOutputEvent(
              'event_cancel_completion_barrier',
              conversationId,
              turnId,
              'generic_tool',
              toolCallId,
              {
                status: 'error',
                observation: 'cancelled during execution',
                error: 'cancelled during execution',
              }
            ),
            'FlowOrchestratorTestRunner.cancelled-tool'
          );
          await runRequest.hostPorts.drainPersistence();
          await runRequest.runHandle.cancel({ reason: 'user cancelled', forceCleanup: false });
          return {
            conversation_id: conversationId,
            events: runRequest.hostPorts.getGeneratedEvents(),
            stepCount: 1,
            terminationReason: 'interrupted',
          };
        })();
        return {
          handle: runRequest.runHandle,
          result,
          then: (onfulfilled, onrejected) => result.then(onfulfilled, onrejected),
        };
      }),
      discardCheckpoint: vi.fn(async () => undefined),
    };
    const persistence = createPersistenceHarness();
    const orchestrator = new FlowOrchestrator(
      persistence.historyHandler,
      agentRunner,
      persistence.coordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      persistence.runtimePersistence
    );
    const execution = orchestrator.next(
      {
        conversation_id: conversationId,
        new_events: [
          {
            type: 'user_input',
            id: 'user_cancel_completion_barrier',
            content: '执行工具后取消',
            timestamp: Date.now(),
            source: 'user',
            turn_id: turnId,
          },
        ],
        options: { model_id: 'test-model' },
      },
      vi.fn()
    );

    await executionStarted.promise;
    const runId = capturedRunRequest?.runHandle.runId;
    if (!runId) throw new Error('expected foreground run to be registered before cancellation');
    let cancelResolved = false;
    const cancellation = orchestrator
      .cancelRun(runId, conversationId, 'user cancelled')
      .then(() => {
        cancelResolved = true;
      });
    await abortObserved.promise;
    await Promise.resolve();

    expect(cancelResolved).toBe(false);
    expect((await persistence.historyRepository.readFrom(conversationId, 0)).events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool_output', tool_call_id: toolCallId }),
      ])
    );

    releaseSettlement.release();
    await cancellation;
    await execution;

    expect((await persistence.historyRepository.readFrom(conversationId, 0)).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_output',
          tool_call_id: toolCallId,
          status: 'error',
        }),
      ])
    );
    expect(agentRunner.discardCheckpoint).toHaveBeenCalledWith(runId);
  });

  it('对话活动收口等待真实 Flow drain 与 Host finalize 后才返回', async () => {
    const conversationId = 'conv_cleanup_completion_barrier';
    const turnId = 'turn_cleanup_completion_barrier';
    const executionStarted = createLatch();
    const abortObserved = createLatch();
    const releaseSettlement = createLatch();
    let capturedRunRequest: FlowAgentRunRequest | undefined;
    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest): FlowAgentRunExecution => {
        capturedRunRequest = runRequest;
        const result = (async (): Promise<FlowExecutionResult> => {
          executionStarted.release();
          await new Promise<void>(resolve => {
            runRequest.runHandle.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          abortObserved.release();
          await releaseSettlement.promise;
          await runRequest.hostPorts.drainPersistence();
          await runRequest.runHandle.cancel({
            reason: 'conversation deletion requested',
            forceCleanup: false,
          });
          return {
            conversation_id: conversationId,
            events: runRequest.hostPorts.getGeneratedEvents(),
            stepCount: 1,
            terminationReason: 'interrupted',
          };
        })();
        return {
          handle: runRequest.runHandle,
          result,
          then: (onfulfilled, onrejected) => result.then(onfulfilled, onrejected),
        };
      }),
      discardCheckpoint: vi.fn(async () => undefined),
    };
    const persistence = createPersistenceHarness();
    const orchestrator = new FlowOrchestrator(
      persistence.historyHandler,
      agentRunner,
      persistence.coordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      persistence.runtimePersistence
    );
    const execution = orchestrator.next(
      {
        conversation_id: conversationId,
        new_events: [
          {
            type: 'user_input',
            id: 'user_cleanup_completion_barrier',
            content: '删除这个仍在执行的对话',
            timestamp: Date.now(),
            source: 'user',
            turn_id: turnId,
          },
        ],
        options: { model_id: 'test-model' },
      },
      vi.fn()
    );

    await executionStarted.promise;
    let stopResolved = false;
    const stopping = orchestrator.stopConversationActivityAndWait(conversationId).then(() => {
      stopResolved = true;
    });
    await abortObserved.promise;
    await Promise.resolve();
    expect(stopResolved).toBe(false);

    releaseSettlement.release();
    await stopping;
    await execution;

    const runId = capturedRunRequest?.runHandle.runId;
    if (!runId) throw new Error('expected Flow run identity before cleanup settlement');
    expect(agentRunner.discardCheckpoint).toHaveBeenCalledWith(runId);
    await expect(
      persistence.runtimePersistence.supervisor.findActiveByConversation(conversationId, {
        includeChildren: true,
      })
    ).resolves.toEqual([]);
  });

  it('persists only fact events while Host owns run status and transport finalization', async () => {
    const toolProcess = RuntimeEventSchema.parse(
      createToolProcessEvent(
        'tool_process_evt_1',
        'conv_contract_1',
        'turn_contract_1',
        'web_search',
        'call_contract_1',
        {
          phase: 'update',
          status: 'loading',
          args: { query: 'phase2' },
        }
      )
    );
    const finalChunk = RuntimeEventSchema.parse(
      createFinalAnswerChunkEvent(
        'answer_chunk_evt_1',
        'conv_contract_1',
        'turn_contract_1',
        'answer_contract_1',
        0,
        'partial',
        {
          is_last: false,
          ephemeral: true,
        }
      )
    );
    const toolOutput = RuntimeEventSchema.parse(
      createToolOutputEvent(
        'tool_output_evt_1',
        'conv_contract_1',
        'turn_contract_1',
        'web_search',
        'call_contract_1',
        { status: 'success', observation: 'completed', data: { ok: true } }
      )
    );
    const finalAnswer = RuntimeEventSchema.parse(
      createFinalAnswerEvent(
        'answer_contract_1',
        'conv_contract_1',
        'turn_contract_1',
        'final answer',
        { completion_reason: 'terminal' }
      )
    );

    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest) =>
        createRunExecution(runRequest, {
          conversation_id: 'conv_contract_1',
          events: [toolProcess, finalChunk, toolOutput, finalAnswer],
          stepCount: 1,
          terminationReason: 'complete',
        })
      ),
      discardCheckpoint: vi.fn(async () => undefined),
    };

    const persistence = createPersistenceHarness();

    const orchestrator = new FlowOrchestrator(
      persistence.historyHandler,
      agentRunner,
      persistence.coordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      persistence.runtimePersistence
    );

    const sseSink = vi.fn();
    const request: ConversationNextRequest = {
      conversation_id: 'conv_contract_1',
      new_events: [
        {
          type: 'user_input',
          id: 'user_evt_contract_1',
          content: 'phase2 contract',
          timestamp: Date.now(),
          source: 'user',
          turn_id: 'turn_contract_1',
        },
      ],
      options: {
        model_id: 'test-model',
      },
    };

    await orchestrator.next(request, sseSink);
    const foregroundRunId = agentRunner.run.mock.calls[0]?.[0].runHandle.runId;

    expect(foregroundRunId).toEqual(expect.any(String));
    expect(foregroundRunId).not.toBe('turn_contract_1');
    const history = await persistence.historyRepository.readFrom('conv_contract_1', 0);
    expect(history.events.map(event => event.type)).toEqual([
      'user_input',
      'tool_output',
      'final_answer',
      'run_execution_metrics',
    ]);
    expect(history.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool_output', id: 'tool_output_evt_1' }),
        expect.objectContaining({ type: 'final_answer', id: 'answer_contract_1' }),
        expect.objectContaining({
          type: 'run_execution_metrics',
          outcome: 'completed',
          user_message_id: 'user_evt_contract_1',
        }),
      ])
    );

    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'user_input_committed',
        id: 'user_evt_contract_1',
        operation: 'append',
      })
    );
    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_status',
        status: 'completed',
      })
    );
    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transport_end',
        conversation_id: 'conv_contract_1',
        turn_id: 'turn_contract_1',
        reason: 'complete',
      })
    );
  });
});
