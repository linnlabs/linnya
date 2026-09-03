import { AgentSpec as AgentSpecSchema } from '../../contracts';
import type {
  AgentSpec,
  EventEnvelope,
  RoutedRuntimeEvent,
  RunTokenUsageAggregate,
  RuntimeEvent,
} from '../../contracts';
import type { AuditPort } from '../../ports';
import { generateAuditEnvelopeId } from '../../contracts';
import { EventBus } from '../execution/event-bus';
import type { EventStore, PersistedEvent } from '../graph-engine/event-store/base';
import { createEventStoreAudit } from '../audit/eventStoreAudit';
import { NotImplementedError } from './runErrors';
import type { RunRecord, RunRegistryStore, RunStatus } from './runRegistryStorePort';
import {
  decideRunLifecycleTransition,
  type RunLifecycleWriteStatus,
} from './functions/runLifecycleTransition';
import type { RunId, ToolCallId } from '../../contracts';

export type RunRequestSnapshot = Readonly<object>;

export interface CancelOpts {
  reason: string;
  forceCleanup?: boolean;
  timeout?: number;
}

export interface RunCost {
  tokensInput: number;
  tokensOutput: number;
  tokenUsage?: RunTokenUsageAggregate;
  tokenLedgerEntryIds?: string[];
  totalCostUsd?: number;
  latencyMs?: number;
  childrenTotal?: RunCost;
}

export interface RunCostCollector {
  snapshot(runId: RunId): RunCost | Promise<RunCost>;
}

export interface RunLifecyclePatch {
  currentNode?: string;
  iterationsUsed?: number;
}

export interface RunAwaitingUserPatch extends RunLifecyclePatch {
  reason?: string;
  eventId?: string;
  interaction?: {
    interactionId: string;
    toolCallId: ToolCallId;
    checkpointRevision: number;
    resumeToken: string;
  };
}

export interface RunFailureInfo {
  errorCode: string;
  message: string;
  recoverable: boolean;
}

export interface RunMeta {
  runId: RunId;
  parentRunId?: RunId;
  agentSpecId?: string;
  conversationId: string;
  status: RunStatus;
  currentNode?: string;
  startedAt: number;
  updatedAt: number;
  pausedAt?: number;
  pauseReason?: string;
  iterationsUsed?: number;
  errorIfAny?: { errorCode: string; message: string; recoverable: boolean };
}

export interface RunObserveFilter {
  /** RuntimeEvent 使用 type 作为主判别字段；保留 kinds 只是为了贴近 N-3 草案措辞。 */
  types?: RuntimeEvent['type'][];
  kinds?: RuntimeEvent['type'][];
  includePersisted?: boolean;
}

export interface RunHandle<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  readonly runId: RunId;
  readonly parentRunId?: RunId;
  readonly signal: AbortSignal;
  spec(): Promise<AgentSpec>;
  request(): Promise<TRequest>;
  /** 将同一个逻辑 run 重新挂载到当前请求的 transport 事件总线。 */
  attachTransportEventBus(eventBus: EventBus): void;
  cancel(opts: CancelOpts, patch?: RunLifecyclePatch): Promise<void>;
  observe(filter?: RunObserveFilter): AsyncIterable<RuntimeEvent>;
  cost(): Promise<RunCost>;
  meta(): Promise<RunMeta>;
  markRunning(patch?: RunLifecyclePatch): Promise<void>;
  markAwaitingUser(patch?: RunAwaitingUserPatch): Promise<void>;
  markCompleted(patch?: RunLifecyclePatch): Promise<void>;
  markFailed(error: RunFailureInfo, patch?: RunLifecyclePatch): Promise<void>;
  pause(reason?: string): Promise<never>;
  resume(): Promise<never>;
}

export interface DefaultRunHandleOptions<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  runRecord: RunRecord;
  abortController: AbortController;
  agentSpec: AgentSpec;
  request: TRequest;
  eventBus: EventBus;
  eventStore: EventStore;
  costCollector: RunCostCollector;
  registryStore: RunRegistryStore;
  auditPort?: AuditPort;
  onCancelled?: (runId: RunId, opts: CancelOpts) => void;
  onTerminal?: (runId: RunId) => void;
}

type EventQueueState = {
  queue: RuntimeEvent[];
  closed: boolean;
  error: Error | null;
  wake: (() => void) | null;
};

function cloneRequest<TRequest extends RunRequestSnapshot>(request: TRequest): TRequest {
  return structuredClone(request);
}

function cloneRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  return structuredClone(event);
}

function runRecordToMeta(record: RunRecord): RunMeta {
  return {
    runId: record.runId,
    parentRunId: record.parentRunId,
    agentSpecId: record.agentSpecId,
    conversationId: record.conversationId,
    status: record.status,
    currentNode: record.currentNode,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    pausedAt: record.pausedAt,
    pauseReason: record.pauseReason,
    iterationsUsed: record.iterationsUsed,
    errorIfAny: record.errorIfAny ? { ...record.errorIfAny } : undefined,
  };
}

function matchesPersistedRunId(runId: RunId, event: PersistedEvent): boolean {
  return event.event.run_id === runId;
}

function matchesRealtimeRunId(runId: RunId, event: RoutedRuntimeEvent): boolean {
  return event.run_id === runId;
}

function matchesEventType(event: RuntimeEvent, filter?: RunObserveFilter): boolean {
  const selectedTypes = filter?.types ?? filter?.kinds;
  return selectedTypes === undefined || selectedTypes.includes(event.type);
}

async function waitForEventQueue(state: EventQueueState): Promise<void> {
  await new Promise<void>(resolve => {
    state.wake = resolve;
  });
  state.wake = null;
}

/**
 * RunHandle 的默认实现只编织现有机制：
 * - cancel 只触发 AbortController，不改 GraphExecutor；
 * - observe 只包装 EventBus/EventStore；
 * - cost 只读取外部注入的 CostCollector。
 */
export class DefaultRunHandle<TRequest extends RunRequestSnapshot = RunRequestSnapshot>
  implements RunHandle<TRequest>
{
  readonly runId: RunId;
  readonly parentRunId?: RunId;

  private runRecord: RunRecord;
  private abortController: AbortController;
  private readonly agentSpecSnapshot: AgentSpec;
  private readonly requestSnapshot: TRequest;
  private transportEventBus: EventBus;
  private readonly observationEventBus: EventBus;
  private readonly eventStore: EventStore;
  private readonly costCollector: RunCostCollector;
  private readonly registryStore: RunRegistryStore;
  private readonly auditPort: AuditPort;
  private readonly onCancelled?: (runId: RunId, opts: CancelOpts) => void;
  private readonly onTerminal?: (runId: RunId) => void;

  constructor(options: DefaultRunHandleOptions<TRequest>) {
    this.runRecord = { ...options.runRecord };
    this.runId = options.runRecord.runId;
    this.parentRunId = options.runRecord.parentRunId;
    this.abortController = options.abortController;
    this.agentSpecSnapshot = AgentSpecSchema.parse(structuredClone(options.agentSpec));
    this.requestSnapshot = cloneRequest(options.request);
    this.transportEventBus = options.eventBus;
    this.observationEventBus = new EventBus(`run-observer:${this.runId}`);
    this.eventStore = options.eventStore;
    this.costCollector = options.costCollector;
    this.registryStore = options.registryStore;
    this.auditPort = options.auditPort ?? createEventStoreAudit({ eventStore: options.eventStore });
    this.onCancelled = options.onCancelled;
    this.onTerminal = options.onTerminal;
    this.attachTransportBridge(this.transportEventBus);
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * awaiting_user 之后的 resume 是同一逻辑 run 的新 execution。
   * 必须切换取消控制器，避免旧 transport 的迟到 abort 污染新 execution。
   */
  replaceExecutionAbortController(controller: AbortController): void {
    this.abortController = controller;
  }

  async spec(): Promise<AgentSpec> {
    return AgentSpecSchema.parse(structuredClone(this.agentSpecSnapshot));
  }

  async request(): Promise<TRequest> {
    return cloneRequest(this.requestSnapshot);
  }

  attachTransportEventBus(eventBus: EventBus): void {
    if (this.transportEventBus === eventBus) {
      return;
    }
    this.detachTransportBridge(this.transportEventBus);
    this.transportEventBus = eventBus;
    this.attachTransportBridge(eventBus);
  }

  async cancel(opts: CancelOpts, patch: RunLifecyclePatch = {}): Promise<void> {
    this.abortController.abort(opts.reason);

    const latestRecord = await this.registryStore.load(this.runId);
    const baseRecord = latestRecord ?? this.runRecord;
    const transition = decideRunLifecycleTransition(baseRecord.status, 'cancelled');
    if (transition.kind === 'skip_terminal') {
      if (transition.terminalStatus === 'cancelled' && hasLifecyclePatch(patch)) {
        // 取消请求先触发 abort，执行器随后才知道真实迭代数。这里只允许补全同一
        // cancelled 终态的执行进度，不重新触发审计、回调或终态资源释放。
        const settledRecord: RunRecord = {
          ...baseRecord,
          updatedAt: Date.now(),
          currentNode: patch.currentNode ?? baseRecord.currentNode,
          iterationsUsed: patch.iterationsUsed ?? baseRecord.iterationsUsed,
        };
        await this.registryStore.save(settledRecord);
        this.runRecord = { ...settledRecord };
        return;
      }
      this.runRecord = { ...baseRecord };
      return;
    }

    const nextRecord: RunRecord = {
      ...baseRecord,
      status: 'cancelled',
      updatedAt: Date.now(),
      currentNode: patch.currentNode ?? baseRecord.currentNode,
      iterationsUsed: patch.iterationsUsed ?? baseRecord.iterationsUsed,
      errorIfAny: {
        errorCode: 'RUN_CANCELLED',
        message: opts.reason,
        recoverable: false,
      },
      metadata: {
        ...(baseRecord.metadata ?? {}),
        cancel: {
          reason: opts.reason,
          forceCleanup: opts.forceCleanup ?? false,
          timeout: opts.timeout,
        },
      },
    };

    await this.registryStore.save(nextRecord);
    this.runRecord = { ...nextRecord };
    await this.auditPort.emit({
      envelopeId: generateAuditEnvelopeId(),
      runId: this.runId,
      parentRunId: this.parentRunId,
      ts: Date.now(),
      actor: { kind: 'host' },
      action: 'run.cancel',
      decision: {
        outcome: 'cancelled',
        reason: opts.reason,
        metadata: {
          forceCleanup: opts.forceCleanup ?? false,
          ...(opts.timeout === undefined ? {} : { timeout: opts.timeout }),
        },
      },
      evidence: [
        {
          kind: 'cancel_request',
          summary: opts.reason,
        },
      ],
      scope: {
        conversationId: nextRecord.conversationId,
        runId: this.runId,
        parentRunId: this.parentRunId,
        agentSpecId: nextRecord.agentSpecId,
      },
    });
    this.closeObservationChannel();
    this.onCancelled?.(this.runId, opts);
  }

  async *observe(filter: RunObserveFilter = {}): AsyncIterable<RuntimeEvent> {
    if (filter.includePersisted) {
      const persistedEvents = await this.eventStore.range(this.runRecord.conversationId);
      for (const persistedEvent of persistedEvents) {
        if (
          matchesPersistedRunId(this.runId, persistedEvent) &&
          matchesEventType(persistedEvent.event, filter)
        ) {
          yield cloneRuntimeEvent(persistedEvent.event);
        }
      }
    }

    const state: EventQueueState = {
      queue: [],
      closed: false,
      error: null,
      wake: null,
    };

    const wake = (): void => {
      state.wake?.();
    };
    const onEvent = (envelope: EventEnvelope<RoutedRuntimeEvent>): void => {
      if (
        matchesRealtimeRunId(this.runId, envelope.payload) &&
        matchesEventType(envelope.payload, filter)
      ) {
        state.queue.push(cloneRuntimeEvent(envelope.payload));
        wake();
      }
    };
    const onError = (error: Error): void => {
      state.error = error;
      wake();
    };
    const onClose = (): void => {
      state.closed = true;
      wake();
    };

    this.observationEventBus.on('event', onEvent);
    this.observationEventBus.on('error', onError);
    this.observationEventBus.on('close', onClose);

    try {
      while (!state.closed || state.queue.length > 0) {
        if (state.error) {
          throw state.error;
        }
        const nextEvent = state.queue.shift();
        if (nextEvent) {
          yield nextEvent;
          continue;
        }
        await waitForEventQueue(state);
      }
    } finally {
      this.observationEventBus.off('event', onEvent);
      this.observationEventBus.off('error', onError);
      this.observationEventBus.off('close', onClose);
    }
  }

  async cost(): Promise<RunCost> {
    return this.costCollector.snapshot(this.runId);
  }

  async meta(): Promise<RunMeta> {
    const latestRecord = await this.registryStore.load(this.runId);
    if (latestRecord) {
      this.runRecord = { ...latestRecord };
    }
    return runRecordToMeta(latestRecord ?? this.runRecord);
  }

  async markRunning(patch: RunLifecyclePatch = {}): Promise<void> {
    await this.saveLifecycleStatus('running', patch);
  }

  async markAwaitingUser(patch: RunAwaitingUserPatch = {}): Promise<void> {
    await this.saveLifecycleStatus('awaiting_user', patch);
  }

  async markCompleted(patch: RunLifecyclePatch = {}): Promise<void> {
    await this.saveLifecycleStatus('completed', patch);
  }

  async markFailed(error: RunFailureInfo, patch: RunLifecyclePatch = {}): Promise<void> {
    await this.saveLifecycleStatus('failed', patch, error);
  }

  async pause(_reason?: string): Promise<never> {
    throw new NotImplementedError('RunHandle.pause is N-3.B; not implemented in N-3.A');
  }

  async resume(): Promise<never> {
    throw new NotImplementedError('RunHandle.resume is N-3.B; not implemented in N-3.A');
  }

  private async saveLifecycleStatus(
    status: Extract<RunLifecycleWriteStatus, 'running' | 'awaiting_user' | 'completed' | 'failed'>,
    patch: RunLifecyclePatch | RunAwaitingUserPatch,
    errorIfAny?: RunFailureInfo
  ): Promise<void> {
    const latestRecord = await this.registryStore.load(this.runId);
    const baseRecord = latestRecord ?? this.runRecord;
    const transition = decideRunLifecycleTransition(baseRecord.status, status);
    if (transition.kind === 'skip_terminal') {
      this.runRecord = { ...baseRecord };
      return;
    }

    const awaitingUserPatch =
      status === 'awaiting_user' ? (patch as RunAwaitingUserPatch) : undefined;
    const updatedAt = Date.now();
    const nextRecord: RunRecord = {
      ...baseRecord,
      status,
      updatedAt,
      currentNode: patch.currentNode ?? baseRecord.currentNode,
      iterationsUsed: patch.iterationsUsed ?? baseRecord.iterationsUsed,
      pauseReason:
        status === 'awaiting_user'
          ? (awaitingUserPatch?.reason ?? baseRecord.pauseReason)
          : undefined,
      pausedAt: status === 'awaiting_user' ? updatedAt : undefined,
      errorIfAny,
      metadata: awaitingUserPatch?.eventId
        ? {
            ...(baseRecord.metadata ?? {}),
            awaitingUser: {
              eventId: awaitingUserPatch.eventId,
              reason: awaitingUserPatch.reason,
              ...(awaitingUserPatch.interaction
                ? { interaction: { ...awaitingUserPatch.interaction, status: 'pending' } }
                : {}),
            },
          }
        : baseRecord.metadata,
    };

    await this.registryStore.save(nextRecord);
    this.runRecord = { ...nextRecord };
    if (status === 'completed' || status === 'failed') {
      this.closeObservationChannel();
      this.onTerminal?.(this.runId);
    }
  }

  private readonly forwardTransportEvent = (envelope: EventEnvelope<RoutedRuntimeEvent>): void => {
    this.observationEventBus.emit('event', envelope);
  };

  private readonly forwardTransportError = (error: Error): void => {
    this.observationEventBus.emit('error', error);
  };

  private readonly detachClosedTransport = (): void => {
    this.detachTransportBridge(this.transportEventBus);
  };

  private attachTransportBridge(eventBus: EventBus): void {
    eventBus.on('event', this.forwardTransportEvent);
    eventBus.on('error', this.forwardTransportError);
    eventBus.on('close', this.detachClosedTransport);
  }

  private detachTransportBridge(eventBus: EventBus): void {
    eventBus.off('event', this.forwardTransportEvent);
    eventBus.off('error', this.forwardTransportError);
    eventBus.off('close', this.detachClosedTransport);
  }

  private closeObservationChannel(): void {
    this.detachTransportBridge(this.transportEventBus);
    this.observationEventBus.close();
  }
}

function hasLifecyclePatch(patch: RunLifecyclePatch): boolean {
  return patch.currentNode !== undefined || patch.iterationsUsed !== undefined;
}

export function runMetaFromRecord(record: RunRecord): RunMeta {
  return runRecordToMeta(record);
}
