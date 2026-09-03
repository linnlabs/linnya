import {
  type ConversationUserInputCommittedEvent,
  type ConversationNextRequest,
} from '@app/schemas';
import { Logger } from 'src/shared/logger';
import { generateRuntimeEventId, type RunId } from '@linnlabs/linnkit/contracts';
import { execution } from '@linnlabs/linnkit/runtime-kernel';
import { SsePort } from 'src/app-hosts/linnya/adapters/realtime/sse.port';
import type { FlowExecutionResult, SSESink } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { EventPersistenceCoordinator } from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import type { FlowRunnerHostPorts } from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import {
  createSSERunStatusEvent,
  createSSETransportEndEvent,
  createSSETransportErrorEvent,
} from '@linnlabs/linnkit/contracts';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type {
  RunMetadata,
  RunSession,
} from 'src/app-hosts/linnya/adapters/persistence/event-store';
import type { graph } from '@linnlabs/linnkit/runtime-kernel';
import type {
  FlowIncomingEventBatch,
  RoutedFlowIncomingEventBatch,
} from './incoming-events/definitions/flowIncomingEventBatch';
import { mapRuntimeAttachmentsToUi } from '../persistence/event-store/ui-projection/attachments';

const logger = new Logger('FlowHostSessionService');
type RunStatus = runSupervisor.RunStatus;

export interface FlowHostSessionServiceOptions {
  conversationId: string;
  sseSink: SSESink;
  shouldPersist: boolean;
  persistenceCoordinator: EventPersistenceCoordinator;
  eventStore: graph.EventStore;
  nextEventStoreId: () => string;
}

export interface FinalizeFlowHostSessionOptions {
  request: ConversationNextRequest;
  result?: FlowExecutionResult;
  didThrow: boolean;
  transportEndReason: 'complete' | 'error' | 'interrupted';
  transportEndReasonMessage?: string;
  runStatus?: RunStatus;
  turnIdHint?: string;
}

/**
 * 当前 Linnya host application layer 的一次 run 会话。
 *
 * 中文备注：
 * - 这里拥有 EventBus / Sequencer / SsePort 建连、输入事实持久化、运行事实持久化、
 *   RuntimeEvent(error) 发射，以及 run status / transport completion 实时投影；
 * - 这些职责都属于 host application session，不应继续散落在 FlowOrchestrator 主流程里。
 */
export class FlowHostSessionService {
  readonly eventBus: execution.EventBus;
  readonly sequencer: execution.EventSequencer;
  private rootRunSession: RunSession | undefined;
  private readonly runEventPersistence: execution.EventBusEventPersistence | undefined;
  private runIdentity:
    | {
        runId: RunId;
        lane: 'foreground' | 'auxiliary';
        visibility: 'conversation' | 'none';
      }
    | undefined;
  private runtimeEventPublisher: execution.RuntimeEventPublisher | undefined;

  constructor(private readonly options: FlowHostSessionServiceOptions) {
    this.sequencer = new execution.EventSequencer(options.conversationId);
    this.eventBus = new execution.EventBus(this.sequencer.getExecutionId());
    if (options.shouldPersist) {
      this.runEventPersistence = new execution.EventBusEventPersistence({
        eventBus: this.eventBus,
        eventStore: options.eventStore,
        nextEventStoreId: options.nextEventStoreId,
      });
      this.runEventPersistence.connect();
    }
    const ssePort = new SsePort(options.sseSink);
    ssePort.connect(this.eventBus);

    logger.info('Flow host session created', {
      conversationId: options.conversationId,
      executionId: this.sequencer.getExecutionId(),
      persistEnabled: options.shouldPersist,
    });
  }

  createRunnerHostPorts(): FlowRunnerHostPorts {
    const persistence = this.runEventPersistence;
    return {
      eventBus: this.eventBus,
      sequencer: this.sequencer,
      realtimeSink: this.options.sseSink,
      runtimeEventSink: (event, source) =>
        this.requireRuntimeEventPublisher().publish(event, source),
      ...(persistence
        ? {
            runtimeEventCommitPort: async (event: RuntimeEvent) => {
              const routed = this.requireRuntimeEventPublisher().route(event);
              await persistence.commitBeforePublish(routed);
            },
          }
        : {}),
      getGeneratedEvents: () => this.requireRuntimeEventPublisher().getGeneratedEvents(),
      drainPersistence: async () => {
        await this.runEventPersistence?.drain();
      },
    };
  }

  bindRunIdentity(identity: {
    runId: RunId;
    lane: 'foreground' | 'auxiliary';
    visibility: 'conversation' | 'none';
  }): void {
    this.runIdentity = identity;
    this.runtimeEventPublisher = new execution.RuntimeEventPublisher(
      this.eventBus,
      this.sequencer,
      {
        run_id: identity.runId,
        lane: identity.lane,
        visibility: identity.visibility,
      }
    );
  }

  async openRootRunSession(runId: RunId): Promise<void> {
    if (!this.options.shouldPersist) {
      return;
    }
    this.rootRunSession = await this.options.persistenceCoordinator.openRunSession(
      this.options.conversationId,
      runId
    );
  }

  async createExplicitRootRunSession(runId: RunId, metadata: RunMetadata): Promise<void> {
    if (!this.options.shouldPersist) {
      return;
    }
    this.rootRunSession = await this.options.persistenceCoordinator.createExplicitRunSession(
      this.options.conversationId,
      runId,
      metadata
    );
  }

  async completeRootRunSession(): Promise<void> {
    if (!this.options.shouldPersist || !this.rootRunSession) {
      return;
    }
    await this.options.persistenceCoordinator.completeRun(this.rootRunSession);
  }

  async failRootRunSession(code: string, error: unknown): Promise<void> {
    if (!this.options.shouldPersist || !this.rootRunSession) {
      return;
    }
    await this.options.persistenceCoordinator.failRun(this.rootRunSession, code, error);
  }

  async persistIncomingEvents(
    request: ConversationNextRequest,
    batch: RoutedFlowIncomingEventBatch
  ): Promise<void> {
    if (!this.options.shouldPersist) {
      return;
    }

    const eventsToPersist = batch.events;
    if (eventsToPersist.length === 0) {
      return;
    }

    const replaceTargetId = request.options?.truncateFromMessageId;
    if (replaceTargetId) {
      if (eventsToPersist.length !== 1 || eventsToPersist[0]?.type !== 'user_input') {
        throw new Error(
          '[FlowHostSessionService] user-input replace requires exactly one user_input event'
        );
      }
      const replacement = eventsToPersist[0];
      await this.options.persistenceCoordinator.replaceUserInputEvent(
        this.requireRootRunSession(),
        replaceTargetId,
        replacement,
        batch.assetCommitsByEventId.get(replacement.id) ?? []
      );
      return;
    }

    logger.info(`Persisting ${eventsToPersist.length} new events immediately`);
    await this.options.persistenceCoordinator.appendEventsToRun(
      this.requireRootRunSession(),
      eventsToPersist,
      batch.assetCommitsByEventId
    );
  }

  /**
   * 这条确认只描述已经 durable commit 的 user input，不进入 EventBus 或 RuntimeEvent 持久化。
   * 调用方必须在 persistAndRelease 成功后、AgentRunner 启动前调用。
   */
  emitCommittedUserInputs(
    request: ConversationNextRequest,
    batch: RoutedFlowIncomingEventBatch
  ): void {
    if (!this.options.shouldPersist) return;
    const replaceTargetId = request.options?.truncateFromMessageId;
    for (const event of batch.events) {
      if (event.type !== 'user_input') continue;
      const attachments = mapRuntimeAttachmentsToUi(event.attachments);
      if (typeof event.raw_content !== 'string') {
        throw new Error('[FlowHostSession] durable user input 缺少 raw_content');
      }
      const committed: ConversationUserInputCommittedEvent = {
        id: event.id,
        type: 'user_input_committed',
        timestamp: event.timestamp,
        conversation_id: event.conversation_id,
        turn_id: event.turn_id,
        operation: replaceTargetId ? 'replace' : 'append',
        ...(replaceTargetId ? { replaced_from_message_id: replaceTargetId } : {}),
        content: event.content,
        raw_content: event.raw_content,
        ...(event.metadata ? { metadata: event.metadata } : {}),
        ...(attachments ? { attachments: [...attachments] } : {}),
      };
      this.options.sseSink(committed);
    }
  }

  /**
   * incoming facts 必须先 durable commit，再通过标准 publisher 进入 realtime/observer fan-out。
   * 它们已在 admission transaction 中落盘，因此这里只发布，不重复计入 generated events 或持久化。
   */
  publishCommittedIncomingEvents(batch: RoutedFlowIncomingEventBatch): void {
    if (!this.options.shouldPersist || batch.events.length === 0) return;
    this.runEventPersistence?.acknowledgePersisted(batch.events);
    const publisher = this.requireRuntimeEventPublisher();
    for (const event of batch.events) {
      publisher.publishRouted(event, 'FlowIncomingEvents.committed', {
        recordInGeneratedJournal: false,
      });
    }
  }

  /** admission 确定 run 后立即附着正式身份，后续持久化、EventBus 与 Runner 共用该批事实。 */
  routeIncomingEventBatch(batch: FlowIncomingEventBatch): RoutedFlowIncomingEventBatch {
    const publisher = this.requireRuntimeEventPublisher();
    return {
      ...batch,
      events: batch.events.map(event => publisher.route(event)),
    };
  }

  async withConversationAdmissionForIncoming<T>(
    request: ConversationNextRequest,
    eventsToPersist: readonly RuntimeEvent[],
    admitted: () => Promise<T> | T,
  ): Promise<T> {
    if (!this.options.shouldPersist) {
      return admitted();
    }

    logger.info(
      `Ensuring conversation ${this.options.conversationId} exists before run registration.`
    );
    return this.options.persistenceCoordinator.withConversationAdmission({
      conversationId: this.options.conversationId,
      initialEvents: eventsToPersist,
      ...(request.project_id !== undefined ? { projectId: request.project_id } : {}),
      admitted,
    });
  }

  emitPreAdmissionTransportError(error: unknown, request: ConversationNextRequest): string {
    const turnId = this.resolveRequestTurnId(request) ?? this.buildTransportTurnId();
    this.options.sseSink(
      createSSETransportErrorEvent(
        `transport_error_${this.sequencer.getExecutionId()}`,
        this.options.conversationId,
        turnId,
        error instanceof Error ? error.message : String(error),
        { execution_id: this.sequencer.getExecutionId() }
      )
    );
    return turnId;
  }

  publishAdmittedRunError(
    error: unknown,
    request: ConversationNextRequest,
    source: string
  ): string {
    const turnId = this.resolveRequestTurnId(request) ?? 'system';
    const runtimeError = execution.createRuntimeErrorEvent({
      id: generateRuntimeEventId(),
      conversationId: this.options.conversationId,
      turnId,
      error: error instanceof Error ? error : new Error(String(error)),
      source,
    });
    this.requireRuntimeEventPublisher().publish(runtimeError, source);
    return turnId;
  }

  async finalize(options: FinalizeFlowHostSessionOptions): Promise<void> {
    const turnId = this.resolveFinalTurnId(options.turnIdHint, options.result, options.request);
    const transportEndReason = this.resolveTransportEndReason(options);
    const executionId = this.sequencer.getExecutionId();

    let finalizeError: unknown;
    try {
      if (this.options.shouldPersist) {
        await this.runEventPersistence?.drain();
      }
      if (this.runIdentity && options.runStatus) {
        this.options.sseSink(
          createSSERunStatusEvent(
            `run_status_${executionId}`,
            this.options.conversationId,
            turnId,
            {
              run_id: this.runIdentity.runId,
              execution_id: executionId,
              status: options.runStatus,
              ...(options.transportEndReasonMessage
                ? { reason_message: options.transportEndReasonMessage }
                : {}),
              lane: this.runIdentity.lane,
              visibility: this.runIdentity.visibility,
            }
          )
        );
      }
      this.options.sseSink(
        createSSETransportEndEvent(
          `transport_end_${executionId}`,
          this.options.conversationId,
          turnId,
          {
            execution_id: executionId,
            reason: transportEndReason,
            ...(options.transportEndReasonMessage
              ? { reason_message: options.transportEndReasonMessage }
              : {}),
            ...(this.runIdentity
              ? {
                  run_id: this.runIdentity.runId,
                  lane: this.runIdentity.lane,
                  visibility: this.runIdentity.visibility,
                }
              : {}),
          }
        )
      );
      logger.info(`Sent transport_end(${transportEndReason}) for execution ${executionId}`);
    } catch (error) {
      finalizeError = error;
      logger.error('Failed to finalize flow host session', error);
    } finally {
      this.eventBus.close();
    }

    if (finalizeError && !options.didThrow) {
      throw finalizeError;
    }
  }

  private requireRootRunSession(): RunSession {
    if (!this.rootRunSession) {
      throw new Error('[FlowHostSessionService] root run session is not open');
    }
    return this.rootRunSession;
  }

  private requireRuntimeEventPublisher(): execution.RuntimeEventPublisher {
    if (!this.runtimeEventPublisher) {
      throw new Error('[FlowHostSessionService] run identity is not bound');
    }
    return this.runtimeEventPublisher;
  }

  private resolveRequestTurnId(request: ConversationNextRequest): string | undefined {
    if (!Array.isArray(request.new_events)) {
      return undefined;
    }

    const turnId = request.new_events[0]?.turn_id;
    return typeof turnId === 'string' && turnId.trim().length > 0 ? turnId.trim() : undefined;
  }

  private resolveFinalTurnId(
    turnIdHint: string | undefined,
    result: FlowExecutionResult | undefined,
    request: ConversationNextRequest
  ): string {
    if (typeof turnIdHint === 'string' && turnIdHint.trim().length > 0) {
      return turnIdHint.trim();
    }

    if (result?.events?.length) {
      const turnId = result.events[0]?.turn_id;
      if (typeof turnId === 'string' && turnId.trim().length > 0) {
        return turnId.trim();
      }
    }

    return this.resolveRequestTurnId(request) ?? this.buildTransportTurnId();
  }

  private resolveTransportEndReason(
    options: FinalizeFlowHostSessionOptions
  ): 'complete' | 'error' | 'interrupted' {
    if (options.didThrow) {
      return 'error';
    }

    if (options.result?.terminationReason === 'interrupted') {
      return 'interrupted';
    }

    if (options.transportEndReason === 'error') {
      return 'error';
    }

    if (options.result?.events?.some(event => event?.type === 'error')) {
      return 'error';
    }

    return options.transportEndReason;
  }

  private buildTransportTurnId(): string {
    return `transport_${this.sequencer.getExecutionId()}`;
  }
}
