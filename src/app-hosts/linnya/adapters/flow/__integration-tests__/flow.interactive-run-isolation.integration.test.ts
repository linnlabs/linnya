import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationInteractionResponseRequest, ConversationNextRequest } from '@app/schemas';
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
import type {
  FlowAgentRunnerPort,
  FlowAgentRunExecution,
  FlowAgentRunRequest,
} from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import type { FlowExecutionResult, SSESink } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import {
  createFlowIntegrationRuntimePersistence,
  InMemoryFlowEventStore,
} from 'src/app-hosts/linnya/testkit/agent-harness/flowIntegrationHarness';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  configureAgentRuntimeSingletons,
  resetAgentRuntimeSingletonsForTest,
} from 'src/electron-main/services/agentRuntimeSingletons';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { readTail } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import {
  createFinalAnswerChunkEvent,
  createRequiresUserInteractionEvent,
  createToolCallDecisionEvent,
  ToolCallIdSchema,
} from '@linnlabs/linnkit/contracts';

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

function createExecution(
  request: FlowAgentRunRequest,
  execute: () => Promise<FlowExecutionResult>
): FlowAgentRunExecution {
  const result = execute();
  return {
    handle: request.runHandle,
    result,
    then: (onfulfilled, onrejected) => result.then(onfulfilled, onrejected),
  };
}

function createUserRequest(
  conversationId: string,
  turnId: string,
  content: string,
  options: NonNullable<ConversationNextRequest['options']>
): ConversationNextRequest {
  return {
    conversation_id: conversationId,
    new_events: [
      {
        type: 'user_input',
        id: `user:${turnId}`,
        content,
        timestamp: Date.now(),
        source: 'user',
        turn_id: turnId,
      },
    ],
    options: { ...options, turn_id: turnId },
  };
}

describe('Flow interactive run isolation', () => {
  const sqliteStores: SQLiteEventStore[] = [];

  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  });

  afterEach(() => {
    for (const store of sqliteStores.splice(0)) {
      store.close();
    }
    clearPluginRuntimeStateForTests();
    resetAgentRuntimeSingletonsForTest();
  });

  it('真实 SQLite 下 foreground wait-user 不受 auxiliary 影响，提交失败可重试且成功后 live/reload 一致', async () => {
    const conversationId = 'conversation-ppt-hitl';
    const db = new Database(':memory:');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
    const eventStore = new SQLiteEventStore(db);
    sqliteStores.push(eventStore);
    const historyRepository = new HistoryRepository(eventStore);
    const historyHandler = new HistoryHandlerService(
      createFlowHistoryAccessPort(historyRepository)
    );
    const persistencePort = createConversationPersistencePort(historyRepository);
    const persistence = new EventPersistenceCoordinator({
      persistencePort,
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    });
    const invocations: FlowAgentRunRequest[] = [];
    const runner: FlowAgentRunnerPort = {
      run: vi.fn(request => {
        invocations.push(request);
        return createExecution(request, async () => {
          if (request.execution.kind === 'resume') {
            request.hostPorts.runtimeEventSink(
              createFinalAnswerChunkEvent(
                'resume-answer-chunk-0',
                conversationId,
                request.turnId,
                'resume-answer',
                0,
                'PPT 需求已确认，',
                { ephemeral: true }
              ),
              'test.resume-answer'
            );
            request.hostPorts.runtimeEventSink(
              createFinalAnswerChunkEvent(
                'resume-answer-chunk-1',
                conversationId,
                request.turnId,
                'resume-answer',
                1,
                '开始生成。',
                { ephemeral: true, is_last: true }
              ),
              'test.resume-answer'
            );
            await request.runHandle.markCompleted({ currentNode: 'answer', iterationsUsed: 4 });
          } else if (request.options?.run_lane === 'auxiliary') {
            await request.runHandle.markCompleted({ currentNode: 'answer', iterationsUsed: 1 });
          } else {
            request.hostPorts.runtimeEventSink(
              createToolCallDecisionEvent(
                'decision-ppt-requirements',
                conversationId,
                request.turnId,
                'ask',
                'ask-ppt-requirements',
                { payload: { args: { topic: 'PPT 需求' } } }
              ),
              'test.wait-user-decision'
            );
            request.hostPorts.runtimeEventSink(
              createRequiresUserInteractionEvent(
                'wait-ppt-requirements',
                conversationId,
                request.turnId,
                {
                  interaction_id: 'interaction-ppt-requirements',
                  run_id: request.runHandle.runId,
                  tool_call_id: ToolCallIdSchema.parse('ask-ppt-requirements'),
                  checkpoint_revision: 7,
                  resume_token: 'resume-ppt-requirements',
                  interaction_status: 'pending',
                  prompt: '请选择 PPT 的受众和页数',
                  form: {
                    data: { questionnaireId: 'ppt-requirements' },
                    observation: '等待用户补充 PPT 需求',
                  },
                }
              ),
              'test.wait-user'
            );
            await request.hostPorts.drainPersistence();
            await request.runHandle.markAwaitingUser({
              currentNode: 'wait_user',
              iterationsUsed: 2,
              eventId: 'wait-ppt-requirements',
              reason: '请选择 PPT 的受众和页数',
              interaction: {
                interactionId: 'interaction-ppt-requirements',
                toolCallId: 'ask-ppt-requirements',
                checkpointRevision: 7,
                resumeToken: 'resume-ppt-requirements',
              },
            });
          }
          return {
            conversation_id: conversationId,
            events: [],
            stepCount: request.execution.kind === 'resume' ? 4 : 1,
            checkpointNodeId: request.execution.kind === 'resume' ? 'answer' : 'wait_user',
            terminationReason: 'complete',
          };
        });
      }),
      discardCheckpoint: vi.fn(async () => undefined),
    };
    const orchestrator = new FlowOrchestrator(
      historyHandler,
      runner,
      persistence,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      configureAgentRuntimeSingletons({ db, eventStore })
    );

    const foregroundSse: Parameters<SSESink>[0][] = [];
    await orchestrator.next(
      createUserRequest(conversationId, 'turn-ppt', '帮我创建一个产品发布 PPT', {
        promptKey: 'conversation_title',
        model_id: 'test-model',
        run_lane: 'foreground',
        event_visibility: 'conversation',
      }),
      event => {
        foregroundSse.push(event);
      }
    );
    const awaiting = await orchestrator.getActiveForegroundRun(conversationId);
    if (!awaiting.run?.pending_interaction) {
      throw new Error('Expected an awaiting foreground interaction');
    }
    const foregroundRunId = awaiting.run.run_id;
    const waitingWindow = readTail(db, conversationId, 20);
    expect(waitingWindow).toMatchObject({
      status: 'ready',
      messages: [
        expect.objectContaining({ message_type: 'user_input' }),
        expect.objectContaining({
          message_type: 'tool_calls',
          payload: expect.objectContaining({
            interaction: {
              status: 'active',
              interactionId: 'interaction-ppt-requirements',
              runId: foregroundRunId,
              checkpointRevision: 7,
              resumeToken: 'resume-ppt-requirements',
            },
          }),
        }),
      ],
    });

    await orchestrator.next(
      createUserRequest(conversationId, 'turn-title', '帮我创建一个产品发布 PPT', {
        promptKey: 'conversation_title',
        model_id: 'test-model',
        run_lane: 'auxiliary',
        event_visibility: 'none',
      }),
      () => undefined,
      undefined,
      { persist: false }
    );

    const afterTitle = await orchestrator.getActiveForegroundRun(conversationId);
    expect(afterTitle.run).toMatchObject({
      run_id: foregroundRunId,
      status: 'awaiting_user',
      pending_interaction: {
        interaction_id: 'interaction-ppt-requirements',
        tool_call_id: 'ask-ppt-requirements',
        checkpoint_revision: 7,
      },
    });
    expect(invocations[1]?.runHandle.runId).not.toBe(foregroundRunId);
    expect(invocations[1]?.options).toMatchObject({
      run_lane: 'auxiliary',
      event_visibility: 'none',
    });
    expect(foregroundSse).toContainEqual(
      expect.objectContaining({
        type: 'run_status',
        run_id: foregroundRunId,
        status: 'awaiting_user',
      })
    );
    expect(foregroundSse).toContainEqual(
      expect.objectContaining({
        type: 'transport_end',
        run_id: foregroundRunId,
        reason: 'complete',
      })
    );

    const interaction = awaiting.run.pending_interaction;
    const response: ConversationInteractionResponseRequest = {
      conversation_id: conversationId,
      run_id: interaction.run_id,
      interaction_id: interaction.interaction_id,
      tool_call_id: interaction.tool_call_id,
      tool_name: 'ask',
      checkpoint_revision: interaction.checkpoint_revision,
      resume_token: interaction.resume_token,
      observation: '受众为客户，10 页',
      data: { answers: { audience: '客户', pages: 10 } },
      interaction_status: 'submitted',
      interaction_submitted_at: 123,
      interaction_response: { audience: '客户', pages: 10 },
    };

    vi.spyOn(persistencePort, 'appendEventToRun').mockRejectedValueOnce(
      new Error('simulated interaction persistence failure')
    );
    await expect(orchestrator.respondInteraction(response, () => undefined)).rejects.toThrow(
      'simulated interaction persistence failure'
    );
    await expect(orchestrator.getActiveForegroundRun(conversationId)).resolves.toMatchObject({
      run: {
        run_id: foregroundRunId,
        status: 'awaiting_user',
        pending_interaction: {
          interaction_id: 'interaction-ppt-requirements',
        },
      },
    });
    await expect(orchestrator.getForegroundRunSettlement(
      conversationId,
      foregroundRunId,
    )).resolves.toMatchObject({
      requested_run_id: foregroundRunId,
      run: {
        run_id: foregroundRunId,
        status: 'awaiting_user',
        pending_interaction: {
          interaction_id: 'interaction-ppt-requirements',
        },
      },
    });
    expect(invocations).toHaveLength(2);

    const resumedSse: Parameters<SSESink>[0][] = [];
    await orchestrator.respondInteraction(response, event => {
      resumedSse.push(event);
    });

    await expect(orchestrator.getActiveForegroundRun(conversationId)).resolves.toEqual({
      conversation_id: conversationId,
      run: null,
    });
    await expect(orchestrator.getForegroundRunSettlement(
      conversationId,
      foregroundRunId,
    )).resolves.toEqual({
      conversation_id: conversationId,
      requested_run_id: foregroundRunId,
      run: {
        run_id: foregroundRunId,
        status: 'completed',
        lane: 'foreground',
      },
    });
    await expect(orchestrator.cancelRun(
      foregroundRunId,
      conversationId,
      'user clicked while natural completion was settling',
    )).resolves.toEqual({
      success: true,
      run_id: foregroundRunId,
      outcome: 'already_terminal',
      terminal_status: 'completed',
    });
    expect(invocations[2]?.runHandle.runId).toBe(foregroundRunId);
    expect(invocations[2]?.execution).toEqual({
      kind: 'resume',
      expectedCheckpointRevision: 7,
    });
    expect(invocations[2]?.request.promptKey).toBe('conversation_title');
    const resumeExecutionId = invocations[2]?.hostPorts.sequencer.getExecutionId();
    expect(resumedSse.filter(event => event.type === 'tool_output')).toEqual([
      expect.objectContaining({
        type: 'tool_output',
        run_id: foregroundRunId,
        execution_id: resumeExecutionId,
        turn_id: 'turn-ppt',
        tool_call_id: 'ask-ppt-requirements',
        observation: '受众为客户，10 页',
        data: { answers: { audience: '客户', pages: 10 } },
        metadata: {
          interaction: {
            status: 'submitted',
            submittedAt: 123,
            response: { audience: '客户', pages: 10 },
          },
        },
      }),
    ]);
    expect(resumedSse.filter(event => event.type === 'final_answer_chunk')).toEqual([
      expect.objectContaining({
        id: 'resume-answer-chunk-0',
        run_id: foregroundRunId,
        execution_id: resumeExecutionId,
        seq: 0,
        chunk: 'PPT 需求已确认，',
      }),
      expect.objectContaining({
        id: 'resume-answer-chunk-1',
        run_id: foregroundRunId,
        execution_id: resumeExecutionId,
        seq: 1,
        chunk: '开始生成。',
      }),
    ]);
    const durableEvents = await eventStore.readEvents(conversationId, {
      direction: 'forward',
      limit: 20,
    });
    expect(durableEvents.events.filter(event => event.type === 'tool_output')).toEqual([
      expect.objectContaining({
        run_id: foregroundRunId,
        tool_call_id: 'ask-ppt-requirements',
        observation: '受众为客户，10 页',
        data: { answers: { audience: '客户', pages: 10 } },
      }),
    ]);
    const resumedWindow = readTail(db, conversationId, 20);
    expect(resumedWindow).toMatchObject({
      status: 'ready',
      messages: [
        expect.objectContaining({ message_type: 'user_input' }),
        expect.objectContaining({
          message_type: 'tool_calls',
          payload: expect.objectContaining({
            status: 'success',
            phase: 'complete',
            interaction: {
              status: 'submitted',
              submittedAt: 123,
              response: { audience: '客户', pages: 10 },
            },
          }),
        }),
      ],
    });
    await expect(orchestrator.respondInteraction(response, () => undefined)).rejects.toThrow(
      `Active run not found for interaction: ${foregroundRunId}`
    );
  });

  it('等待态 approve resume 已 claim 时，cancel 必须等待 canonical incoming fact 与 Host finalize 收尾', async () => {
    const conversationId = 'conversation-resume-cancel-barrier';
    const eventStore = new InMemoryFlowEventStore();
    const historyRepository = new HistoryRepository(eventStore);
    const historyHandler = new HistoryHandlerService(
      createFlowHistoryAccessPort(historyRepository)
    );
    const persistencePort = createConversationPersistencePort(historyRepository);
    const persistence = new EventPersistenceCoordinator({
      persistencePort,
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    });
    const resumePersistenceStarted = createLatch();
    const releaseResumePersistence = createLatch();
    const runner: FlowAgentRunnerPort = {
      run: vi.fn(request =>
        createExecution(request, async () => {
          if (request.execution.kind === 'resume') {
            throw new Error('cancelled resume must not reach AgentRunner');
          }
          await request.runHandle.markAwaitingUser({
            currentNode: 'wait_user',
            iterationsUsed: 1,
            eventId: 'wait-resume-cancel',
            reason: '等待用户确认',
            interaction: {
              interactionId: 'interaction-resume-cancel',
              toolCallId: 'call-resume-cancel',
              checkpointRevision: 3,
              resumeToken: 'token-resume-cancel',
            },
          });
          return {
            conversation_id: conversationId,
            events: [],
            stepCount: 1,
            checkpointNodeId: 'wait_user',
            terminationReason: 'complete',
          };
        })
      ),
      discardCheckpoint: vi.fn(async () => undefined),
    };
    const orchestrator = new FlowOrchestrator(
      historyHandler,
      runner,
      persistence,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      createFlowIntegrationRuntimePersistence(eventStore)
    );

    await orchestrator.next(
      createUserRequest(conversationId, 'turn-resume-cancel', '需要用户确认', {
        promptKey: 'default',
        model_id: 'test-model',
        run_lane: 'foreground',
        event_visibility: 'conversation',
      }),
      () => undefined
    );
    const active = await orchestrator.getActiveForegroundRun(conversationId);
    const interaction = active.run?.pending_interaction;
    if (!interaction) throw new Error('expected an awaiting foreground interaction');

    const appendEventToRun = persistencePort.appendEventToRun.bind(persistencePort);
    vi.spyOn(persistencePort, 'appendEventToRun').mockImplementation(
      async (session, event, options) => {
        if (event.type === 'tool_output' && event.tool_call_id === interaction.tool_call_id) {
          resumePersistenceStarted.release();
          await releaseResumePersistence.promise;
        }
        await appendEventToRun(session, event, options);
      }
    );

    const response: ConversationInteractionResponseRequest = {
      conversation_id: conversationId,
      run_id: interaction.run_id,
      interaction_id: interaction.interaction_id,
      tool_call_id: interaction.tool_call_id,
      tool_name: 'ask',
      checkpoint_revision: interaction.checkpoint_revision,
      resume_token: interaction.resume_token,
      observation: '{"action":"approve"}',
      data: { action: 'approve' },
      interaction_status: 'approved',
      interaction_submitted_at: 456,
      interaction_response: { action: 'approve' },
    };
    const resume = orchestrator.respondInteraction(response, () => undefined);
    await resumePersistenceStarted.promise;

    let cancelResolved = false;
    const cancellation = orchestrator
      .cancelRun(interaction.run_id, conversationId, 'user cancelled during resume admission')
      .then(() => {
        cancelResolved = true;
      });
    await Promise.resolve();
    expect(cancelResolved).toBe(false);

    releaseResumePersistence.release();
    await expect(resume).rejects.toThrow();
    await cancellation;

    expect(cancelResolved).toBe(true);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.discardCheckpoint).toHaveBeenCalledWith(interaction.run_id);
    expect(
      (
        await eventStore.readEvents(conversationId, {
          direction: 'forward',
          limit: 20,
        })
      ).events
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_output',
          run_id: interaction.run_id,
          tool_call_id: interaction.tool_call_id,
          status: 'success',
          observation: expect.stringContaining('等待的用户确认已经完成'),
          data: { action: 'approve' },
          metadata: {
            interaction: {
              status: 'approved',
              submittedAt: 456,
              response: { action: 'approve' },
            },
          },
        }),
      ])
    );
  });
});
