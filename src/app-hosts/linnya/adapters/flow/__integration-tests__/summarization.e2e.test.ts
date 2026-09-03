import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationNextRequest } from '@app/schemas';
import { FlowOrchestrator } from 'src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import { FlowIncomingEventPreparer } from 'src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import { createDirectFlowConversationAdmissionPort } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDirectFlowConversationAdmissionPort';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import type { RuntimeEvent, SSEEvent } from 'linnkit/contracts';
import { createRunExecutionMetricsEvent, routeRuntimeEvent } from 'linnkit/contracts';
import type { FlowExecutionResult } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import type { FlowAgentRunExecution, FlowAgentRunRequest } from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import type { RunMetadata } from 'src/app-hosts/linnya/adapters/persistence/event-store';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import {
  configureAgentRuntimeSingletons,
  resetAgentRuntimeSingletonsForTest,
} from 'src/electron-main/services/agentRuntimeSingletons';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

function createSummaryEvent(
  conversationId: string,
  turnId: string,
  replacedMessageIds: string[],
): Extract<RuntimeEvent, { type: 'history_summary' }> {
  return {
    type: 'history_summary',
    id: 'summary_evt_1',
    conversation_id: conversationId,
    turn_id: turnId,
    timestamp: 2000,
    version: 1,
    content: '历史已压缩为摘要。',
    original_message_count: replacedMessageIds.length,
    replaced_message_ids: replacedMessageIds,
    compression_ratio: 0.5,
    included_old_summary: false,
    summary_seq: 1,
  };
}

function createFinalAnswerEvent(conversationId: string, turnId: string): Extract<RuntimeEvent, { type: 'final_answer' }> {
  return {
    type: 'final_answer',
    id: 'answer_1',
    conversation_id: conversationId,
    turn_id: turnId,
    timestamp: 2100,
    version: 1,
    answer_id: 'answer_1',
    content: '这是新的最终回答。',
    is_complete: true,
    completion_reason: 'terminal',
  };
}

function createRunExecution(
  runRequest: FlowAgentRunRequest,
  result: FlowExecutionResult,
): FlowAgentRunExecution {
  const resultPromise = (async (): Promise<FlowExecutionResult> => {
    for (const event of result.events) {
      runRequest.hostPorts.runtimeEventSink(event, 'SummarizationTestRunner');
    }
    runRequest.hostPorts.runtimeEventSink(createRunExecutionMetricsEvent(
      `metrics_${runRequest.hostPorts.sequencer.getExecutionId()}`,
      runRequest.conversationId,
      runRequest.turnId,
      {
        execution_id: runRequest.hostPorts.sequencer.getExecutionId(),
        outcome: 'completed',
        duration_ms: 1,
        ...(runRequest.newEvents.find(event => event.type === 'user_input')?.id
          ? { user_message_id: runRequest.newEvents.find(event => event.type === 'user_input')?.id }
          : {}),
      },
    ), 'SummarizationTestRunner.metrics');
    await runRequest.hostPorts.drainPersistence();
    await runRequest.runHandle.markCompleted({
      currentNode: result.checkpointNodeId,
      iterationsUsed: result.stepCount,
    });
    return { ...result, events: runRequest.hostPorts.getGeneratedEvents() };
  })();
  return {
    handle: runRequest.runHandle,
    result: resultPromise,
    then: (onfulfilled, onrejected) => resultPromise.then(onfulfilled, onrejected),
  };
}

async function appendEventsToRunForTest(
  coordinator: EventPersistenceCoordinator,
  conversationId: string,
  runId: string,
  events: RuntimeEvent[],
  metadata: RunMetadata,
): Promise<void> {
  const session = await coordinator.createExplicitRunSession(conversationId, runId, metadata);
  await coordinator.appendEventsToRun(session, events.map(event => routeRuntimeEvent(event, {
    run_id: runId,
    lane: 'foreground',
    visibility: 'conversation',
  })));
  await coordinator.completeRun(session);
}

function createPersistenceFixture(): {
  db: Database.Database;
  eventStore: SQLiteEventStore;
  historyRepository: HistoryRepository;
  historyHandler: HistoryHandlerService;
  persistenceCoordinator: EventPersistenceCoordinator;
  runtime: ReturnType<typeof configureAgentRuntimeSingletons>;
} {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }

  const eventStore = new SQLiteEventStore(db);
  const runtime = configureAgentRuntimeSingletons({ db, eventStore });
  const historyRepository = new HistoryRepository(eventStore);
  const historyHandler = new HistoryHandlerService(
    createFlowHistoryAccessPort(historyRepository),
  );
  const persistenceCoordinator = new EventPersistenceCoordinator({
    persistencePort: createConversationPersistencePort(historyRepository),
    conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
  });

  return { db, eventStore, historyRepository, historyHandler, persistenceCoordinator, runtime };
}

describe('Summarization flow contract regression', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
    resetAgentRuntimeSingletonsForTest();
  });

  it('应通过 FlowOrchestrator 持久化并实时投影同一 summary fact，progress 仅走 SSE', async () => {
    const conversationId = 'conv_summarization_flow_contract';
    const turnId = 'turn_sum_contract_1';
    const { eventStore, historyRepository, historyHandler, persistenceCoordinator, runtime } = createPersistenceFixture();
    const sseEvents: SSEEvent[] = [];

    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest) => {
        runRequest.hostPorts.realtimeSink({
          type: 'summarization_start',
          id: 'sum_start_1',
          summarization_id: 'sum_start_1',
          timestamp: 1900,
          conversation_id: conversationId,
          turn_id: 'system',
          run_id: runRequest.runHandle.runId,
          execution_id: 'execution-summary-test',
        });
        runRequest.hostPorts.realtimeSink({
          type: 'summarization_end',
          id: 'sum_end_1',
          summarization_id: 'sum_start_1',
          timestamp: 1950,
          conversation_id: conversationId,
          turn_id: 'system',
          run_id: runRequest.runHandle.runId,
          execution_id: 'execution-summary-test',
          summary_id: 'summary_evt_1',
          original_message_count: 2,
          compressed_message_count: 1,
          compression_ratio: 0.5,
        });

        return createRunExecution(runRequest, {
          conversation_id: conversationId,
          stepCount: 1,
          terminationReason: 'complete',
          events: [
            createSummaryEvent(conversationId, turnId, ['user_evt_1']),
            createFinalAnswerEvent(conversationId, turnId),
          ],
        });
      }),
      discardCheckpoint: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new FlowOrchestrator(
      historyHandler,
      agentRunner,
      persistenceCoordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      runtime,
    );

    const request: ConversationNextRequest = {
      conversation_id: conversationId,
      new_events: [
        {
          type: 'user_input',
          id: 'user_evt_1',
          content: '请把之前内容压缩一下再继续。',
          timestamp: 1000,
          turn_id: turnId,
          source: 'user',
        },
      ],
      options: {
        model_id: 'test-model',
      },
    };

    const result = await orchestrator.next(request, (event) => {
      sseEvents.push(event as SSEEvent);
    });

    const history = await historyRepository.readFrom(conversationId, 0);
    const runtimeEventTypes = history.events.map((event) => event.type);
    const persistedSummaries = history.events.filter((event) => event.type === 'history_summary');
    const persistedExecutionMetrics = history.events.filter(
      (event) => event.type === 'run_execution_metrics',
    );
    const sseEventTypes = sseEvents.map((event) => event.type);

    expect(result.events).toHaveLength(3);
    expect(runtimeEventTypes).toEqual([
      'user_input',
      'history_summary',
      'final_answer',
      'run_execution_metrics',
    ]);
    expect(persistedSummaries).toHaveLength(1);
    expect(persistedExecutionMetrics).toHaveLength(1);
    expect(persistedSummaries[0]).toMatchObject({
      type: 'history_summary',
      replaced_message_ids: ['user_evt_1'],
    });

    expect(sseEventTypes).toEqual([
      'user_input_committed',
      'summarization_start',
      'summarization_end',
      'history_summary',
      'final_answer',
      'run_execution_metrics',
      'run_status',
      'transport_end',
    ]);
    const realtimeSummary = sseEvents.find(event => event.type === 'history_summary');
    expect(realtimeSummary).toMatchObject({
      id: 'summary_evt_1',
      summary_id: 'summary_evt_1',
      run_id: persistedSummaries[0]?.run_id,
    });
    expect(history.events.some((event) => String(event.type) === 'summarization_start')).toBe(false);
    expect(history.events.some((event) => String(event.type) === 'summarization_end')).toBe(false);
    eventStore.close();
  });

  it('应保持 replaced_message_ids 作为 Flow 持久化后的权威字段', async () => {
    const conversationId = 'conv_summarization_authority';
    const turnId = 'turn_sum_authority_1';
    const { eventStore, historyRepository, historyHandler, persistenceCoordinator, runtime } = createPersistenceFixture();

    await persistenceCoordinator.withConversationAdmission({
      conversationId,
      initialEvents: [{
        type: 'user_input',
        id: 'user_evt_old',
        content: '旧用户输入',
        conversation_id: conversationId,
        timestamp: 800,
        turn_id: 'turn_prev',
        version: 1,
        source: 'user',
      }, {
        type: 'final_answer',
        id: 'answer_prev',
        content: '旧助手回答',
        conversation_id: conversationId,
        timestamp: 900,
        turn_id: 'turn_prev',
        version: 1,
        answer_id: 'answer_prev',
        is_complete: true,
        completion_reason: 'terminal',
      }],
      admitted: () => undefined,
    });
    await appendEventsToRunForTest(
      persistenceCoordinator,
      conversationId,
      'turn_prev',
      [
        {
          type: 'user_input',
          id: 'user_evt_old',
          content: '旧用户输入',
          conversation_id: conversationId,
          timestamp: 800,
          turn_id: 'turn_prev',
          version: 1,
          source: 'user',
        },
        {
          type: 'final_answer',
          id: 'answer_prev',
          content: '旧助手回答',
          conversation_id: conversationId,
          timestamp: 900,
          turn_id: 'turn_prev',
          version: 1,
          answer_id: 'answer_prev',
          is_complete: true,
          completion_reason: 'terminal',
        },
      ],
      { kind: 'user_input', toolset_version: '1.0' },
    );

    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest) => createRunExecution(runRequest, {
        conversation_id: conversationId,
        stepCount: 1,
        terminationReason: 'complete',
        events: [
          createSummaryEvent(conversationId, turnId, ['user_evt_old', 'answer_prev', 'user_evt_1']),
          createFinalAnswerEvent(conversationId, turnId),
        ],
      })),
      discardCheckpoint: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new FlowOrchestrator(
      historyHandler,
      agentRunner,
      persistenceCoordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      runtime,
    );

    await orchestrator.next(
      {
        conversation_id: conversationId,
        new_events: [
          {
            type: 'user_input',
            id: 'user_evt_1',
            content: '继续',
            timestamp: 1000,
            turn_id: turnId,
            source: 'user',
          },
        ],
        options: {
          model_id: 'test-model',
        },
      },
      vi.fn(),
    );

    const history = await historyRepository.readFrom(conversationId, 0);
    const summary = history.events.find(
      (event): event is Extract<RuntimeEvent, { type: 'history_summary' }> => event.type === 'history_summary',
    );
    const replacedIds = new Set(
      history.events
        .filter((event): event is Extract<RuntimeEvent, { type: 'history_summary' }> => event.type === 'history_summary')
        .flatMap((event) => event.replaced_message_ids ?? []),
    );
    const filteredHistory = history.events.filter((event) => event.type === 'history_summary' || !replacedIds.has(event.id));

    expect(summary).toBeDefined();
    expect(summary?.replaced_message_ids).toEqual(['user_evt_old', 'answer_prev', 'user_evt_1']);
    expect((summary as Record<string, unknown>)).not.toHaveProperty('replaces_message_ids');
    expect(filteredHistory.map((event) => event.type)).toEqual([
      'history_summary',
      'final_answer',
      'run_execution_metrics',
    ]);
    eventStore.close();
  });
});
