/**
 * @file src/app-hosts/linnya/adapters/flow/flow.orchestrator.ts
 * @description Flow编排器
 * @description 轻量级编排器，负责按顺序调用各个业务服务，串联起整个对话流程。
 * @description 它不实现任何具体的业务逻辑，只负责协调调用。
 */

import { Logger } from 'src/shared/logger';
import { HistoryHandlerService } from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import type { FlowAgentRunnerPort } from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import { EventPersistenceCoordinator } from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import type {
  ConversationActiveRunResponse,
  ConversationInteractionResponseRequest,
  ConversationNextRequest,
  ConversationRunCancelResponse,
  ConversationRunSettlementResponse,
  ConversationRunContinueRequest,
} from '@app/schemas';
import {
  generateRuntimeEventId,
  ExecutionIdSchema,
  runIdFromTurnId,
  RunIdSchema,
  ToolCallIdSchema,
  type RunId,
  type ToolCallId,
} from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import {
  FlowExecutionResult,
  type FlowRunAcceptance,
  SSESink,
} from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { FlowHostSessionService } from 'src/app-hosts/linnya/adapters/flow/flow.host-session.service';
import { FlowRunPreparationService } from 'src/app-hosts/linnya/adapters/flow/flow.run-preparation.service';
import { resolveTurnId } from 'src/app-hosts/linnya/adapters/flow/agent-runner/runBootstrapper';
import { assignIncomingEventIds } from 'src/app-hosts/linnya/adapters/flow/flow.incoming-event-identities';
import {
  resolveRunnableDefinitionForAgentSpec,
  runnableDefinitionToAgentSpec,
} from 'src/app-hosts/linnya/adapters/runtime/agentDefinitionToAgentSpec';
import { FlowIncomingEventPreparer } from './incoming-events/orchestration/prepareFlowIncomingEventBatch';
import { projectActiveForegroundRun } from './interactive-run/functions/projectActiveForegroundRun';
import { buildInteractionResponseIncomingEvent } from './interactive-run/functions/buildInteractionResponseIncomingEvent';
import {
  createFlowExecutionCompletionRegistry,
  type FlowExecutionCompletionRegistry,
} from './interactive-run/orchestration/flowExecutionCompletionRegistry';
import {
  stopConversationFlowActivity,
  stopFlowRunAndWait,
} from './interactive-run/orchestration/stopConversationFlowActivity';
import { readForegroundRunSettlement } from './interactive-run/orchestration/readForegroundRunSettlement';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { RunDescriptor } from '../../application/run-resumption';
import type { FlowRuntimePort } from './flow.runtime';
import { continueFlowRun } from './flow.run-continuation';
import { admitDurableFlowStart } from './flow.run-admission';
import {
  admitConversationAgentChoice,
  resolveConversationAgentPromptKey,
} from './functions/admitConversationAgentChoice';

const logger = new Logger('FlowOrchestrator');

type FlowCommand =
  | { readonly kind: 'start' }
  | {
      readonly kind: 'resume';
      readonly runId: RunId;
      readonly interaction: {
        readonly interactionId: string;
        readonly toolCallId: ToolCallId;
        readonly checkpointRevision: number;
        readonly resumeToken: string;
      };
    };

interface FlowExecutionLifecycleObserver {
  readonly onAccepted: (acceptance: FlowRunAcceptance) => void;
}

class FlowLifecycleSettlementError extends Error {
  constructor(
    readonly flowError: unknown,
    readonly lifecycleError: unknown
  ) {
    super('Flow failed and its Host lifecycle settlement also failed');
    this.name = 'FlowLifecycleSettlementError';
  }
}

/**
 * @class FlowOrchestrator
 */
export class FlowOrchestrator {
  private readonly runPreparationService: FlowRunPreparationService;
  private readonly executionCompletions: FlowExecutionCompletionRegistry;

  /**
   * 构造函数
   *
   * @param {HistoryHandlerService} historyHandler - 历史处理服务，负责事件截断和追加
   * @param {AgentRunnerService} agentRunner - Agent模式运行服务（现在同时处理 Chat 和 Agent 模式）
   * @param {EventPersistenceCoordinator} persistenceCoordinator - 事件持久化协调器
   */
  constructor(
    private readonly historyHandler: HistoryHandlerService,
    private readonly agentRunner: FlowAgentRunnerPort,
    private readonly persistenceCoordinator: EventPersistenceCoordinator,
    private readonly incomingEventPreparer: FlowIncomingEventPreparer,
    private readonly runtime: FlowRuntimePort
  ) {
    this.runPreparationService = new FlowRunPreparationService(
      historyHandler,
      incomingEventPreparer
    );
    this.executionCompletions = createFlowExecutionCompletionRegistry();
  }

  /**
   * 执行下一轮对话
   *
   * 这是整个对话流程的入口，按照以下步骤协调各个服务：
   * 1. 初始化会话（如果需要）
   * 2. 处理历史事件（截断或追加）
   * 3. 构建AI上下文
   * 4. 根据模式，委托给相应的Runner执行
   *
   * @param {ConversationNextRequest} req - 对话请求对象，包含用户输入和配置
   * @param {SSESink} sseSink - SSE事件发送器，用于实时推送事件到前端
   * @param {AbortSignal} [signal] - 中断信号，用于取消执行
   * @param {Object} [options] - 🔥 新增：执行选项
   * @param {boolean} [options.persist=true] - 是否持久化事件到数据库
   * @returns {Promise<FlowExecutionResult>} 执行结果，包含会话ID、事件数组和步骤数
   *
   * Side-effects:
   * - 修改EventStore中的会话和事件数据（当 persist=true 时）
   * - 通过SSE向前端推送实时事件
   * - 可能触发AI模型调用和工具执行
   */
  async next(
    req: ConversationNextRequest,
    sseSink: SSESink,
    signal?: AbortSignal,
    options?: { persist?: boolean }
  ): Promise<FlowExecutionResult> {
    return this.execute(req, sseSink, signal, options, { kind: 'start' });
  }

  /**
   * 启动由 Host 持有的持久化执行。调用方连接在回执后结束不会取消 run。
   */
  async nextDetached(req: ConversationNextRequest): Promise<FlowRunAcceptance> {
    return this.executeDetached(admitConversationAgentChoice(req), { kind: 'start' });
  }

  async respondInteraction(
    response: ConversationInteractionResponseRequest,
    sseSink: SSESink,
    signal?: AbortSignal
  ): Promise<FlowExecutionResult> {
    const prepared = await this.prepareInteractionResume(response);
    return this.execute(prepared.request, sseSink, signal, undefined, prepared.command);
  }

  /** interaction response durable commit 后由 Host 继续持有新的 execution。 */
  async respondInteractionDetached(
    response: ConversationInteractionResponseRequest
  ): Promise<FlowRunAcceptance> {
    const prepared = await this.prepareInteractionResume(response);
    return this.executeDetached(prepared.request, prepared.command);
  }

  private async prepareInteractionResume(
    response: ConversationInteractionResponseRequest
  ): Promise<{
    readonly request: ConversationNextRequest;
    readonly command: Extract<FlowCommand, { kind: 'resume' }>;
  }> {
    const runId = RunIdSchema.parse(response.run_id);
    const toolCallId = ToolCallIdSchema.parse(response.tool_call_id);
    const snapshot = (
      await this.runtime.supervisor.findActiveByConversation(response.conversation_id)
    ).find(run => run.runId === runId);
    if (!snapshot) {
      throw new Error(`Active run not found for interaction: ${response.run_id}`);
    }
    const turnId =
      typeof snapshot.metadata?.turnId === 'string' ? snapshot.metadata.turnId : undefined;
    if (!turnId) {
      throw new Error(`Run ${response.run_id} does not have a stable turnId`);
    }
    if (!snapshot.agentSpecId) {
      throw new Error(`Run ${response.run_id} does not have a stable Agent identity`);
    }
    const promptKey = resolveConversationAgentPromptKey(snapshot.agentSpecId);
    const request: ConversationNextRequest = {
      conversation_id: response.conversation_id,
      project_id: response.project_id,
      new_events: [
        buildInteractionResponseIncomingEvent({
          response,
          turnId,
          eventId: generateRuntimeEventId(),
          timestamp: Date.now(),
        }),
      ],
      options: {
        turn_id: turnId,
        // resume 是同一逻辑 run 的新 execution，必须恢复原 Agent 路由；
        // 若省略，HistoryBuilder 会回退 default，回执和执行上下文都会漂移。
        promptKey,
        project_metadata: response.project_metadata,
        run_lane: 'foreground',
        event_visibility: 'conversation',
      },
    };
    return {
      request,
      command: {
        kind: 'resume',
        runId,
        interaction: {
          interactionId: response.interaction_id,
          toolCallId,
          checkpointRevision: response.checkpoint_revision,
          resumeToken: response.resume_token,
        },
      },
    };
  }

  async cancelRun(
    runId: string,
    conversationId: string,
    reason: string
  ): Promise<ConversationRunCancelResponse> {
    const admittedRunId = RunIdSchema.parse(runId);
    const settlement = await stopFlowRunAndWait({
      runId: admittedRunId,
      conversationId,
      reason,
      runtime: {
        supervisor: this.runtime.supervisor,
        executionCompletions: this.executionCompletions,
        discardCheckpoint: targetRunId => this.agentRunner.discardCheckpoint(targetRunId),
        releaseCost: targetRunId => this.runtime.costCollector.release(targetRunId),
      },
    });
    return settlement.outcome === 'cancelled'
      ? {
          success: true,
          run_id: admittedRunId,
          outcome: 'cancelled',
          terminal_status: 'cancelled',
        }
      : {
          success: true,
          run_id: admittedRunId,
          outcome: 'already_terminal',
          terminal_status: settlement.terminalStatus,
        };
  }

  async stopConversationActivityAndWait(conversationId: string): Promise<void> {
    await stopConversationFlowActivity({
      conversationId,
      runtime: {
        supervisor: this.runtime.supervisor,
        executionCompletions: this.executionCompletions,
        discardCheckpoint: runId => this.agentRunner.discardCheckpoint(runId),
        releaseCost: runId => this.runtime.costCollector.release(runId),
      },
    });
  }

  async getActiveForegroundRun(conversationId: string): Promise<ConversationActiveRunResponse> {
    const runs = await this.runtime.supervisor.findActiveByConversation(conversationId);
    return projectActiveForegroundRun(conversationId, runs);
  }

  async pauseRun(
    runId: string,
    conversationId: string,
    expectedExecutionId: string
  ): Promise<ConversationActiveRunResponse> {
    const id = RunIdSchema.parse(runId);
    if (!(await this.runtime.runDescriptors?.exists(id)))
      throw new Error('Run has no durable continuation inputs');
    const snapshot = (await this.runtime.supervisor.findByConversation(conversationId)).find(
      run => run.runId === id
    );
    if (
      !snapshot ||
      snapshot.conversationId !== conversationId ||
      snapshot.parentRunId ||
      snapshot.metadata?.lane !== 'foreground'
    ) {
      throw new Error('Pause target is not a foreground root run of this conversation');
    }
    if (snapshot.metadata?.executionId !== expectedExecutionId)
      throw new Error('Pause execution identity is stale');
    const pending = this.executionCompletions.findPending(id);
    if (snapshot.status === 'running' || snapshot.status === 'pending') {
      if (!pending) throw new Error('Running Flow has no execution completion');
      await this.runtime.supervisor.pause(
        id,
        'user_pause',
        ExecutionIdSchema.parse(expectedExecutionId)
      );
    }
    if (pending) await pending;
    return this.getActiveForegroundRun(conversationId);
  }

  continueRun(
    runId: string,
    command: ConversationRunContinueRequest,
    sink: SSESink
  ): Promise<FlowExecutionResult> {
    return continueFlowRun({
      runId,
      command,
      sink,
      runtime: this.runtime,
      runner: this.agentRunner,
      persistenceCoordinator: this.persistenceCoordinator,
      completions: this.executionCompletions,
    });
  }

  async getForegroundRunSettlement(
    conversationId: string,
    runId: string
  ): Promise<ConversationRunSettlementResponse> {
    return readForegroundRunSettlement({
      conversationId,
      runId: RunIdSchema.parse(runId),
      supervisor: this.runtime.supervisor,
      executionCompletions: this.executionCompletions,
    });
  }

  private async execute(
    req: ConversationNextRequest,
    sseSink: SSESink,
    signal: AbortSignal | undefined,
    options: { persist?: boolean } | undefined,
    command: FlowCommand,
    lifecycleObserver?: FlowExecutionLifecycleObserver
  ): Promise<FlowExecutionResult> {
    const request = assignIncomingEventIds(req);
    const shouldPersist = options?.persist !== false; // 默认为 true
    let didThrow = false;
    const conversationId = request.conversation_id || `conv_${Date.now()}`;
    const turnId = resolveTurnId(request.options, request.new_events);
    logger.info(`Starting conversation flow for ${conversationId}`);

    const hostSession = new FlowHostSessionService({
      conversationId,
      sseSink,
      shouldPersist,
      persistenceCoordinator: this.persistenceCoordinator,
      eventStore: this.runtime.eventStore,
      nextEventStoreId: this.runtime.nextEventStoreId,
      createCheckpointWriter: this.runtime.createCheckpointWriter,
    });

    let result: FlowExecutionResult | undefined;
    let turnIdForTransportEnd: string | undefined;
    let runIdForTransportEnd: RunId | undefined;
    let transportEndReason: 'complete' | 'error' | 'interrupted' = 'complete';
    let runHandle: runSupervisor.RunHandle<AgentInvokeRequest> | undefined;
    let executionCompletion: ReturnType<FlowExecutionCompletionRegistry['register']> | undefined;
    let resumeClaim: runSupervisor.RunResumeClaim<AgentInvokeRequest> | undefined;
    let runAccepted = false;
    let runnerDispatched = false;
    let recoveryInputs: RunDescriptor | undefined;
    let incomingCommitted = false;
    let replacedPausedRunId: RunId | undefined;
    let flowError: unknown;

    try {
      const preparation = await this.runPreparationService.prepareForRun(
        request,
        conversationId,
        turnId,
        shouldPersist
      );

      if (preparation.kind === 'persist_only') {
        turnIdForTransportEnd = turnId;
        const hostOnlyRunId = runIdFromTurnId(turnId);
        result = await hostSession.withConversationAdmissionForIncoming(
          request,
          preparation.incomingBatch.events,
          async () => {
            hostSession.bindRunIdentity({
              runId: hostOnlyRunId,
              lane: 'foreground',
              visibility: 'conversation',
            });
            const incomingBatch = hostSession.routeIncomingEventBatch(preparation.incomingBatch);
            await hostSession.createExplicitRootRunSession(hostOnlyRunId, {
              kind: 'user_input',
              toolset_version: 'linnya-host-only',
            });
            try {
              await this.incomingEventPreparer.persistAndRelease(incomingBatch, () =>
                hostSession.persistIncomingEvents(request, incomingBatch)
              );
              hostSession.emitCommittedUserInputs(request, incomingBatch);
              await hostSession.completeRootRunSession();
              return preparation.result;
            } catch (error) {
              await hostSession.failRootRunSession('HOST_ONLY_RUN_FAILED', error);
              throw error;
            }
          }
        );
      } else {
        const registrationPrepared = preparation.prepared;
        const { agentInvokeReq: registrationRequest, incomingBatch: preparedIncomingBatch } =
          registrationPrepared;
        logger.info('Routing to agent mode via unified AgentRunner');
        turnIdForTransportEnd = turnId;
        const definition = resolveRunnableDefinitionForAgentSpec(registrationRequest.promptKey);
        if (!definition) {
          throw new Error(
            `[FlowOrchestrator] 未找到 promptKey="${registrationRequest.promptKey}" 的 AgentDefinition`
          );
        }
        const runLane = request.options?.run_lane ?? 'foreground';
        const eventVisibility =
          request.options?.event_visibility ?? (runLane === 'auxiliary' ? 'none' : 'conversation');
        const admittedRun = await hostSession.withConversationAdmissionForIncoming(
          request,
          preparedIncomingBatch.events,
          async () => {
            // run/claim 必须在 lifecycle gate 释放前成为可观察 owner；否则删除可能在
            // admission 和 owner 注册之间插入，漏掉刚启动的工作。
            if (command.kind === 'resume') {
              executionCompletion = this.executionCompletions.register(
                command.runId,
                conversationId
              );
            }
            const resolvedRunHandle =
              command.kind === 'resume'
                ? await (async () => {
                    resumeClaim = await this.runtime.supervisor.claimResume(
                      command.runId,
                      command.interaction,
                      hostSession.eventBus,
                      signal
                    );
                    return resumeClaim.handle;
                  })()
                : await (async () => {
                    if (shouldPersist && this.runtime.runDescriptors) {
                      const admitted = await admitDurableFlowStart({
                        runtime: this.runtime,
                        runner: this.agentRunner,
                        host: hostSession,
                        prepared: registrationPrepared,
                        request,
                        conversationId,
                        turnId,
                        agentSpec: runnableDefinitionToAgentSpec(definition),
                        lane: runLane,
                        visibility: eventVisibility,
                        signal,
                      });
                      recoveryInputs = admitted.descriptor;
                      replacedPausedRunId = admitted.replacedRunId;
                      incomingCommitted = true;
                      runAccepted = true;
                      return admitted.handle;
                    }
                    const registeredHandle = await this.runtime.supervisor.registerRun({
                      concurrencyKey:
                        runLane === 'foreground'
                          ? `conversation:${conversationId}:foreground`
                          : undefined,
                      parentSignal: signal,
                      conversationId,
                      agentSpec: runnableDefinitionToAgentSpec(definition),
                      request: registrationRequest,
                      eventBus: hostSession.eventBus,
                      eventStore: this.runtime.eventStore,
                      costCollector: this.runtime.costCollector,
                      metadata: {
                        executionId: hostSession.sequencer.getExecutionId(),
                        turnId,
                        traceId: registrationRequest.review_run_id ?? turnId,
                        originalSource: 'flow',
                        lane: runLane,
                        visibility: eventVisibility,
                      },
                    });
                    runAccepted = true;
                    return registeredHandle;
                  })();
            runHandle = resolvedRunHandle;
            if (command.kind === 'start') {
              executionCompletion = this.executionCompletions.register(
                resolvedRunHandle.runId,
                conversationId
              );
            }
            runIdForTransportEnd = resolvedRunHandle.runId;
            hostSession.bindRunIdentity({
              runId: resolvedRunHandle.runId,
              lane: runLane,
              visibility: eventVisibility,
            });
            const incomingBatch = hostSession.routeIncomingEventBatch(preparedIncomingBatch);
            const hostPorts = hostSession.createRunnerHostPorts();
            await hostSession.openRootRunSession(resolvedRunHandle.runId);
            return { resolvedRunHandle, incomingBatch, hostPorts };
          }
        );
        const { resolvedRunHandle, incomingBatch, hostPorts } = admittedRun;
        if (shouldPersist && this.runtime.runDescriptors) {
          if (command.kind === 'resume') {
            recoveryInputs =
              (await this.runtime.runDescriptors.load(resolvedRunHandle.runId)) ?? undefined;
            if (!recoveryInputs)
              throw new Error('Original interaction run descriptor is unavailable');
          }
        }

        /**
         * 中文备注：
         * - destination run 必须先注册，原子 replace 才能明确保护这条新 run；
         * - run 行必须先由 linnkit RunSupervisor 注册，保证 SQLite `runs.id`
         *   与 runtime root runId 是同一个事实。
         */
        if (resumeClaim && recoveryInputs) {
          const admission = this.runtime.runAdmissionCommit;
          if (!admission) throw new Error('Durable interaction admission is unavailable');
          await resumeClaim.activate({
            executionId: hostSession.sequencer.getExecutionId(),
            inputEventIds: incomingBatch.events.map(event => event.id),
            admissionCommit: (previous, next) =>
              admission.resume({ previous, next, incoming: incomingBatch }),
          });
          runAccepted = true;
          incomingCommitted = true;
        }
        if (!incomingCommitted) await hostSession.persistIncomingEvents(request, incomingBatch);
        if (resumeClaim && !runAccepted) {
          await resumeClaim.activate({ executionId: hostSession.sequencer.getExecutionId() });
          runAccepted = true;
        }
        hostSession.publishCommittedIncomingEvents(incomingBatch);
        hostSession.emitCommittedUserInputs(request, incomingBatch);
        // 回执之后的 draft/旧断点维护不撤销已提交的用户输入；恢复数据仍以新 run 为 owner。
        try {
          await this.incomingEventPreparer.releaseCommittedDrafts(incomingBatch);
          if (replacedPausedRunId) {
            await this.agentRunner.discardCheckpoint(replacedPausedRunId);
            this.runtime.costCollector.release(replacedPausedRunId);
          }
        } catch (cleanupError) {
          logger.error('Committed admission resource cleanup deferred', cleanupError);
        }

        lifecycleObserver?.onAccepted({
          conversationId,
          incomingEventIds: incomingBatch.events.map(event => event.id),
          turnId,
          runId: resolvedRunHandle.runId,
          executionId: hostSession.sequencer.getExecutionId(),
          agentId: definition.id,
          acceptedAt: Date.now(),
        });

        const executionPrepared =
          shouldPersist && !recoveryInputs
            ? await this.runPreparationService.prepareExecutionAfterPersistence(
                request,
                conversationId,
                incomingBatch
              )
            : registrationPrepared;
        const { agentInvokeReq, contextHistoryEvents, effectiveOptions } = executionPrepared;

        logger.info('[FlowOrchestrator] dispatching to AgentRunner', { conversationId });
        const execution = this.agentRunner.run({
          conversationId,
          turnId,
          request: agentInvokeReq,
          history: contextHistoryEvents,
          newEvents: [...incomingBatch.events],
          options: effectiveOptions,
          hostPorts,
          runHandle: resolvedRunHandle,
          recoveryInputs,
          execution:
            command.kind === 'resume'
              ? {
                  kind: 'resume',
                  expectedCheckpointRevision: command.interaction.checkpointRevision,
                }
              : { kind: 'start' },
        });
        runnerDispatched = true;
        result = await execution.result;

        if (!shouldPersist) {
          logger.info(
            `Skipping persistence (persist=false), returning ${result.events?.length || 0} events in memory only`
          );
        } else {
          logger.info('AI events persisted incrementally from EventBus');
        }
      }
    } catch (error) {
      didThrow = true;
      transportEndReason = 'error';
      flowError = error;

      try {
        if (resumeClaim && !runAccepted) {
          await resumeClaim.release();
        } else if (runHandle && runAccepted && !runnerDispatched) {
          hostSession.createRunnerHostPorts().finishCheckpointWrites?.();
          if (recoveryInputs) {
            // 用户输入已经原子接纳，装配失败不能撤销它或清掉可继续的原输入。
            await runHandle.markPaused({ reason: 'execution_setup_failed' });
          } else {
            turnIdForTransportEnd = hostSession.publishAdmittedRunError(
              flowError,
              request,
              'FlowOrchestrator.preDispatch'
            );
            await hostSession.createRunnerHostPorts().drainPersistence();
            await runHandle.markFailed({
              errorCode: 'RUN_DISPATCH_FAILED',
              message: error instanceof Error ? error.message : String(error),
              recoverable: false,
            });
            await this.agentRunner.discardCheckpoint(runHandle.runId);
            this.runtime.costCollector.release(runHandle.runId);
          }
        } else if (!runnerDispatched) {
          turnIdForTransportEnd = hostSession.emitPreAdmissionTransportError(flowError, request);
        }
      } catch (lifecycleError) {
        flowError = new FlowLifecycleSettlementError(error, lifecycleError);
      }
    }

    let settlementError: unknown;
    let didSettlementThrow = false;
    try {
      const runMeta = runIdForTransportEnd
        ? await this.runtime.supervisor.peek(runIdForTransportEnd)
        : null;
      const transportEndReasonMessage =
        result?.terminationReason === 'interrupted' ? runMeta?.errorIfAny?.message : undefined;
      await hostSession.finalize({
        request,
        result,
        didThrow,
        transportEndReason,
        transportEndReasonMessage,
        runStatus: runMeta?.status,
        turnIdHint: turnIdForTransportEnd,
      });
      executionCompletion?.complete();
    } catch (error) {
      didSettlementThrow = true;
      settlementError = error;
      executionCompletion?.fail(error);
    }

    if (didThrow) {
      if (didSettlementThrow) {
        throw new FlowLifecycleSettlementError(flowError, settlementError);
      }
      throw flowError;
    }
    if (didSettlementThrow) {
      throw settlementError;
    }
    if (!result) {
      throw new Error('Flow completed without a result');
    }
    return result;
  }

  private executeDetached(
    request: ConversationNextRequest,
    command: FlowCommand
  ): Promise<FlowRunAcceptance> {
    return new Promise<FlowRunAcceptance>((resolve, reject) => {
      let accepted = false;
      const execution = this.execute(request, () => undefined, undefined, undefined, command, {
        onAccepted: acceptance => {
          accepted = true;
          resolve(acceptance);
        },
      });

      void execution
        .then(() => {
          if (!accepted) {
            reject(new Error('Flow completed without entering Host-owned execution'));
          }
        })
        .catch((error: unknown) => {
          if (!accepted) {
            reject(error);
            return;
          }
          logger.error('[FlowOrchestrator] detached execution failed after acceptance', {
            conversationId: request.conversation_id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }
}
