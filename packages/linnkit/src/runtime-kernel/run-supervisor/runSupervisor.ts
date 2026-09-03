import type { RunId, RuntimeEvent } from '../../contracts';
import type { AuditPort } from '../../ports';
import { generateRunId, generateRunResumeClaimId } from '../../contracts';
import { DefaultRunHandle } from './runHandle';
import type {
  DefaultRunSupervisorOptions,
  FindActiveByConversationOptions,
  FindRunsByConversationOptions,
  RunExecutorPort,
  RunOutcome,
  RunRegistrationSpec,
  RunResumeClaim,
  RunResumeInteraction,
  RunSnapshot,
  RunSupervisor,
  RunWaitForTerminalOptions,
} from './definitions/runSupervisorContracts';
import {
  createAwaitingUserWatcher,
  type AwaitingUserWatcher,
} from './functions/awaitingUserWatcher';
import {
  createDetachedRunExecutor,
  type DetachedRunExecutor,
} from './functions/detachedRunExecutor';
import { createRunSlotLimiter, type RunSlotLimiter } from './functions/runSlotLimiter';
import {
  createRunConcurrencyKeyRegistry,
  type RunConcurrencyKeyRegistry,
} from './functions/runConcurrencyKeyRegistry';
import { runRecordToMeta, runRecordToSnapshot } from './functions/runRecordProjection';
import { createInitialRunRecord, forwardParentAbortSignal } from './functions/runRegistration';
import { recoverRunsOnBoot } from './functions/runRecovery';
import {
  createTerminalWaiterRegistry,
  type TerminalWaiterRegistry,
} from './functions/terminalWaiterRegistry';
import type {
  CancelOpts,
  RunAwaitingUserPatch,
  RunHandle,
  RunMeta,
  RunObserveFilter,
  RunRequestSnapshot,
} from './runHandle';
import {
  NotImplementedError,
  RunAlreadyRegisteredError,
  RunNotAwaitingUserError,
  RunInteractionConflictError,
  RunNotFoundError,
} from './runErrors';
import type { ListRunsFilter, RunRecord, RunRegistryStore } from './runRegistryStorePort';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type {
  DefaultRunSupervisorOptions,
  FindActiveByConversationOptions,
  FindRunsByConversationOptions,
  RunExecutionContext,
  RunExecutorPort,
  RunOutcome,
  RunRegistrationSpec,
  RunResumeClaim,
  RunResumeInteraction,
  RunSnapshot,
  RunSupervisor,
  RunTerminalError,
  RunTerminalEvent,
  RunTerminalStatus,
  RunWaitForTerminalOptions,
} from './definitions/runSupervisorContracts';

export class DefaultRunSupervisor<TRequest extends RunRequestSnapshot = RunRequestSnapshot>
  implements RunSupervisor<TRequest>
{
  private readonly registryStore: RunRegistryStore;
  private readonly auditPort?: AuditPort;
  private readonly executor?: RunExecutorPort<TRequest>;
  private readonly runIdFactory: () => RunId;
  private readonly now: () => number;
  private readonly terminalWaiterRegistry: TerminalWaiterRegistry;
  private readonly runSlotLimiter: RunSlotLimiter;
  private readonly runConcurrencyKeys: RunConcurrencyKeyRegistry;
  private readonly awaitingUserWatcher: AwaitingUserWatcher;
  private readonly detachedRunExecutor: DetachedRunExecutor<TRequest>;
  private readonly handles = new Map<RunId, DefaultRunHandle<TRequest>>();
  private readonly controllers = new Map<RunId, AbortController>();
  private readonly inFlight = new Map<RunId, Promise<RunOutcome>>();
  private readonly eventWatchDisposers = new Map<RunId, () => void>();
  private readonly controlOperations = new Map<RunId, Promise<void>>();

  constructor(options: DefaultRunSupervisorOptions<TRequest>) {
    this.registryStore = options.registryStore;
    this.auditPort = options.auditPort;
    this.executor = options.executor;
    this.runIdFactory = options.runIdFactory ?? generateRunId;
    this.now = options.now ?? (() => Date.now());
    this.terminalWaiterRegistry = createTerminalWaiterRegistry({
      loadRecord: runId => this.registryStore.load(runId),
    });
    this.runSlotLimiter = createRunSlotLimiter({ maxActiveRuns: options.maxActiveRuns });
    this.runConcurrencyKeys = createRunConcurrencyKeyRegistry();
    this.awaitingUserWatcher = createAwaitingUserWatcher({
      markAwaitingUser: (runId, patch) => this.getHandle(runId).markAwaitingUser(patch),
      onDisposed: runId => {
        this.eventWatchDisposers.delete(runId);
        // SSE transport 结束不等于 run 终态。awaiting_user 必须保留原 handle 与 request，
        // resume 激活时再轮换 execution signal，继续同一个 run 而不是注册替代 run。
        void this.registryStore.load(runId).then(record => {
          if (
            !record ||
            record.status === 'completed' ||
            record.status === 'failed' ||
            record.status === 'cancelled'
          ) {
            this.releaseRunHandleResources(runId);
            if (!this.inFlight.has(runId)) {
              this.releaseRunAdmission(runId);
            }
          }
        });
      },
    });
    this.detachedRunExecutor = createDetachedRunExecutor<TRequest>({
      executor: this.executor,
      registryStore: this.registryStore,
      now: this.now,
      notifyTerminal: outcome => this.notifyTerminalWaiters(outcome.runId),
      cleanupRunResources: runId => this.cleanupRunResources(runId),
    });
  }

  async registerRun(spec: RunRegistrationSpec<TRequest>): Promise<RunHandle<TRequest>> {
    const runId = spec.runId ?? this.runIdFactory();
    if (this.handles.has(runId) || (await this.registryStore.load(runId))) {
      throw new RunAlreadyRegisteredError(runId);
    }
    this.acquireRunAdmission(runId, spec.concurrencyKey);

    const startedAt = this.now();
    const controller = new AbortController();
    forwardParentAbortSignal(controller, spec.parentSignal);

    const record: RunRecord = createInitialRunRecord({ runId, spec, startedAt });

    try {
      await this.registryStore.save(record);
    } catch (error) {
      this.releaseRunAdmission(runId);
      throw error;
    }

    try {
      const handle = new DefaultRunHandle<TRequest>({
        runRecord: record,
        abortController: controller,
        agentSpec: spec.agentSpec,
        request: spec.request,
        eventBus: spec.eventBus,
        eventStore: spec.eventStore,
        costCollector: spec.costCollector,
        registryStore: this.registryStore,
        auditPort: this.auditPort,
        onCancelled: cancelledRunId => {
          // detached executor 仍在收口时，取消只是 abort 请求；资源和 terminal waiter
          // 必须等 executor 把最终进度写入 RunRegistryStore 后再处理。
          if (this.inFlight.has(cancelledRunId)) {
            return;
          }
          this.cleanupRunResources(cancelledRunId);
          void this.registryStore.load(cancelledRunId).then(cancelledRecord => {
            if (cancelledRecord?.status === 'cancelled') {
              this.notifyTerminalWaiters(cancelledRunId);
            }
          });
        },
        onTerminal: terminalRunId => {
          this.cleanupRunResources(terminalRunId);
        },
      });

      this.handles.set(runId, handle);
      this.controllers.set(runId, controller);
      this.attachAwaitingUserWatcher(runId, spec.eventBus);
      return handle;
    } catch (error) {
      this.releaseRunHandleResources(runId);
      this.releaseRunAdmission(runId);
      throw error;
    }
  }

  async spawnDetached(spec: RunRegistrationSpec<TRequest>): Promise<RunHandle<TRequest>> {
    if (!this.executor) {
      throw new NotImplementedError('RunSupervisor.spawnDetached requires a RunExecutorPort');
    }

    const handle = await this.registerRun(spec);
    const execution = this.detachedRunExecutor.executeDetachedRun(handle, spec);
    this.inFlight.set(handle.runId, execution);
    void execution.finally(() => {
      this.inFlight.delete(handle.runId);
    });
    return handle;
  }

  async *observeRun(runId: RunId, filter?: RunObserveFilter): AsyncIterable<RuntimeEvent> {
    const handle = this.getHandle(runId);
    yield* handle.observe(filter);
  }

  async cancel(runId: RunId, opts: CancelOpts): Promise<void> {
    await this.withRunControlLock(runId, async () => {
      await this.getHandle(runId).cancel(opts);
    });
  }

  async markAwaitingUser(runId: RunId, patch: RunAwaitingUserPatch = {}): Promise<void> {
    await this.getHandle(runId).markAwaitingUser(patch);
  }

  async list(filter?: ListRunsFilter): Promise<{ runs: RunMeta[]; nextCursor?: string }> {
    const result = await this.registryStore.list(filter);
    return {
      runs: result.runs.map(runRecordToMeta),
      nextCursor: result.nextCursor,
    };
  }

  async peek(runId: RunId): Promise<RunMeta | null> {
    const record = await this.registryStore.load(runId);
    return record ? runRecordToMeta(record) : null;
  }

  async waitForTerminal(runId: RunId, opts: RunWaitForTerminalOptions = {}): Promise<RunOutcome> {
    return this.terminalWaiterRegistry.waitForTerminal(runId, opts);
  }

  async findActiveByConversation(
    conversationId: string,
    opts: FindActiveByConversationOptions = {}
  ): Promise<RunSnapshot[]> {
    return this.findByConversation(conversationId, {
      ...opts,
      status: ['pending', 'running', 'awaiting_user', 'paused'],
    });
  }

  async findByConversation(
    conversationId: string,
    opts: FindRunsByConversationOptions = {}
  ): Promise<RunSnapshot[]> {
    const result = await this.registryStore.list({
      conversationId,
      status: opts.status,
      agentSpecId: opts.agentSpecId,
    });
    return result.runs
      .filter(record => opts.includeChildren === true || record.parentRunId === undefined)
      .map(runRecordToSnapshot);
  }

  async drain(opts: RunWaitForTerminalOptions = {}): Promise<RunOutcome[]> {
    const runIds = Array.from(this.inFlight.keys());
    return Promise.all(runIds.map(runId => this.waitForTerminal(runId, opts)));
  }

  async recoverOnBoot(
    reason = 'process restarted before run reached terminal status'
  ): Promise<RunOutcome[]> {
    return recoverRunsOnBoot({
      registryStore: this.registryStore,
      reason,
      now: this.now,
      notifyTerminal: outcome => this.notifyTerminalWaiters(outcome.runId),
    });
  }

  async pause(_runId: RunId, _reason?: string): Promise<never> {
    throw new NotImplementedError('RunSupervisor.pause is N-3.B; not implemented in N-3.A');
  }

  async claimResume(
    runId: RunId,
    interaction: RunResumeInteraction,
    eventBus: import('../execution/event-bus').EventBus,
    parentSignal?: AbortSignal
  ): Promise<RunResumeClaim<TRequest>> {
    return this.withRunControlLock(runId, async () => {
      const handle = this.getHandle(runId);
      const record = await this.registryStore.load(runId);
      if (!record) {
        throw new RunNotFoundError(runId);
      }
      if (record.status !== 'awaiting_user') {
        throw new RunNotAwaitingUserError(runId, record.status);
      }
      const awaitingUser = isRecord(record.metadata?.awaitingUser)
        ? record.metadata.awaitingUser
        : undefined;
      const pendingInteraction =
        awaitingUser && isRecord(awaitingUser.interaction) ? awaitingUser.interaction : undefined;
      if (!awaitingUser || !pendingInteraction) {
        throw new RunInteractionConflictError(runId, 'pending interaction is missing');
      }
      if (pendingInteraction.status !== 'pending') {
        throw new RunInteractionConflictError(
          runId,
          `interaction is ${String(pendingInteraction.status)}`
        );
      }
      if (isRecord(awaitingUser.resumeClaim)) {
        throw new RunInteractionConflictError(runId, 'interaction response is already claimed');
      }
      const mismatchedField = (
        ['interactionId', 'toolCallId', 'checkpointRevision', 'resumeToken'] as const
      ).find(field => pendingInteraction[field] !== interaction[field]);
      if (mismatchedField) {
        throw new RunInteractionConflictError(runId, `${mismatchedField} does not match`);
      }
      const controller = this.controllers.get(runId);
      if (!controller) {
        throw new RunNotFoundError(runId);
      }
      const claimId = generateRunResumeClaimId();
      await this.registryStore.save({
        ...record,
        updatedAt: this.now(),
        metadata: {
          ...(record.metadata ?? {}),
          awaitingUser: {
            ...awaitingUser,
            resumeClaim: {
              claimId,
              claimedAt: this.now(),
            },
          },
        },
      });
      handle.attachTransportEventBus(eventBus);
      this.attachAwaitingUserWatcher(runId, eventBus);
      return {
        runId,
        handle,
        activate: execution => this.activateResumeClaim(runId, claimId, parentSignal, execution),
        release: () => this.releaseResumeClaim(runId, claimId),
      };
    });
  }

  async runTree(_rootRunId: RunId): Promise<never> {
    throw new NotImplementedError('RunSupervisor.runTree is N-3.B; not implemented in N-3.A');
  }

  async handleFailure(_runId: RunId, _error: unknown): Promise<never> {
    throw new NotImplementedError('RunSupervisor.handleFailure is N-3.B; not implemented in N-3.A');
  }

  private notifyTerminalWaiters(runId: RunId): void {
    this.terminalWaiterRegistry.notify(runId);
  }

  private acquireRunAdmission(runId: RunId, concurrencyKey: string | undefined): void {
    this.runConcurrencyKeys.acquire(runId, concurrencyKey);
    try {
      this.runSlotLimiter.acquire(runId);
    } catch (error) {
      this.runConcurrencyKeys.release(runId);
      throw error;
    }
  }

  private releaseRunAdmission(runId: RunId): void {
    this.runSlotLimiter.release(runId);
    this.runConcurrencyKeys.release(runId);
  }

  private releaseRunHandleResources(runId: RunId): void {
    this.handles.delete(runId);
    this.controllers.delete(runId);
  }

  private cleanupRunResources(runId: RunId): void {
    this.releaseRunHandleResources(runId);
    this.releaseRunAdmission(runId);
    const disposeWatch = this.eventWatchDisposers.get(runId);
    if (disposeWatch) {
      disposeWatch();
      this.eventWatchDisposers.delete(runId);
    }
  }

  private attachAwaitingUserWatcher(
    runId: RunId,
    eventBus: import('../execution/event-bus').EventBus
  ): void {
    this.eventWatchDisposers.get(runId)?.();
    const dispose = this.awaitingUserWatcher.watch(runId, eventBus);
    this.eventWatchDisposers.set(runId, dispose);
  }

  private async activateResumeClaim(
    runId: RunId,
    claimId: string,
    parentSignal?: AbortSignal,
    execution?: { readonly executionId: import('../../contracts').ExecutionId },
  ): Promise<RunHandle<TRequest>> {
    return this.withRunControlLock(runId, async () => {
      const handle = this.getHandle(runId);
      const record = await this.registryStore.load(runId);
      if (!record) {
        throw new RunNotFoundError(runId);
      }
      if (record.status !== 'awaiting_user') {
        throw new RunNotAwaitingUserError(runId, record.status);
      }
      const awaitingUser = isRecord(record.metadata?.awaitingUser)
        ? record.metadata.awaitingUser
        : undefined;
      const resumeClaim =
        awaitingUser && isRecord(awaitingUser.resumeClaim) ? awaitingUser.resumeClaim : undefined;
      if (!awaitingUser || resumeClaim?.claimId !== claimId) {
        throw new RunInteractionConflictError(runId, 'resume claim is no longer active');
      }
      const pendingInteraction = isRecord(awaitingUser.interaction)
        ? awaitingUser.interaction
        : undefined;
      if (!pendingInteraction || pendingInteraction.status !== 'pending') {
        throw new RunInteractionConflictError(runId, 'pending interaction is no longer available');
      }
      if (!this.controllers.has(runId)) {
        throw new RunNotFoundError(runId);
      }
      const awaitingUserWithoutClaim = { ...awaitingUser };
      Reflect.deleteProperty(awaitingUserWithoutClaim, 'resumeClaim');
      await this.registryStore.save({
        ...record,
        status: 'running',
        updatedAt: this.now(),
        currentNode: 'llm',
        pauseReason: undefined,
        pausedAt: undefined,
        metadata: {
          ...(record.metadata ?? {}),
          ...(execution ? { executionId: execution.executionId } : {}),
          awaitingUser: {
            ...awaitingUserWithoutClaim,
            interaction: {
              ...pendingInteraction,
              status: 'submitted',
            },
          },
        },
      });
      // resume 是同一逻辑 run 的新 execution。只有 claim 激活后的新 transport
      // 才能取消它，旧 transport 的迟到 abort 不得跨 execution 传播。
      const executionController = new AbortController();
      forwardParentAbortSignal(executionController, parentSignal);
      handle.replaceExecutionAbortController(executionController);
      this.controllers.set(runId, executionController);
      return handle;
    });
  }

  private async releaseResumeClaim(runId: RunId, claimId: string): Promise<void> {
    await this.withRunControlLock(runId, async () => {
      const record = await this.registryStore.load(runId);
      if (!record || record.status !== 'awaiting_user') {
        return;
      }
      const awaitingUser = isRecord(record.metadata?.awaitingUser)
        ? record.metadata.awaitingUser
        : undefined;
      const resumeClaim =
        awaitingUser && isRecord(awaitingUser.resumeClaim) ? awaitingUser.resumeClaim : undefined;
      if (!awaitingUser || resumeClaim?.claimId !== claimId) {
        return;
      }
      const awaitingUserWithoutClaim = { ...awaitingUser };
      Reflect.deleteProperty(awaitingUserWithoutClaim, 'resumeClaim');
      await this.registryStore.save({
        ...record,
        updatedAt: this.now(),
        metadata: {
          ...(record.metadata ?? {}),
          awaitingUser: awaitingUserWithoutClaim,
        },
      });
    });
  }

  private getHandle(runId: RunId): DefaultRunHandle<TRequest> {
    const handle = this.handles.get(runId);
    if (!handle) {
      throw new RunNotFoundError(runId);
    }
    return handle;
  }

  private async withRunControlLock<TResult>(
    runId: RunId,
    operation: () => Promise<TResult>
  ): Promise<TResult> {
    const previous = this.controlOperations.get(runId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.controlOperations.set(runId, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.controlOperations.get(runId) === queued) {
        this.controlOperations.delete(runId);
      }
    }
  }
}
