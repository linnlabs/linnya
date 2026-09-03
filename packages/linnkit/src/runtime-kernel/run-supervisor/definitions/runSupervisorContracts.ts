import type { AgentSpec, ExecutionId, RunId, RuntimeEvent, ToolCallId } from '../../../contracts';
import type { AuditPort } from '../../../ports';
import type { EventBus } from '../../execution/event-bus';
import type { EventStore } from '../../graph-engine/event-store/base';
import type {
  CancelOpts,
  RunAwaitingUserPatch,
  RunCostCollector,
  RunHandle,
  RunMeta,
  RunObserveFilter,
  RunRequestSnapshot,
} from '../runHandle';
import type { ListRunsFilter, RunRecord, RunRegistryStore } from '../runRegistryStorePort';

export type RunTerminalStatus = Extract<RunRecord['status'], 'completed' | 'failed' | 'cancelled'>;

export type RunTerminalError = {
  errorCode: string;
  message: string;
  recoverable: boolean;
};

export interface RunOutcome {
  runId: RunId;
  status: RunTerminalStatus;
  completedAt: number;
  currentNode?: string;
  iterationsUsed?: number;
  error?: RunTerminalError;
  metadata?: Record<string, unknown>;
}

export interface RunSnapshot extends RunMeta {
  metadata?: Record<string, unknown>;
}

export interface RunTerminalEvent {
  runId: RunId;
  status: RunTerminalStatus;
  outcome: RunOutcome;
}

export interface RunWaitForTerminalOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface FindActiveByConversationOptions {
  includeChildren?: boolean;
  agentSpecId?: string;
}

export interface FindRunsByConversationOptions extends FindActiveByConversationOptions {
  status?: ListRunsFilter['status'];
}

export interface RunResumeInteraction {
  interactionId: string;
  toolCallId: ToolCallId;
  checkpointRevision: number;
  resumeToken: string;
}

export interface RunResumeClaim<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  readonly runId: RunId;
  readonly handle: RunHandle<TRequest>;
  /** 同一逻辑 run 的新 execution 身份必须与 claim 激活原子写入。 */
  activate(execution?: { readonly executionId: ExecutionId }): Promise<RunHandle<TRequest>>;
  release(): Promise<void>;
}

export interface RunExecutionContext<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  runId: RunId;
  parentRunId?: RunId;
  conversationId: string;
  agentSpec: AgentSpec;
  request: TRequest;
  signal: AbortSignal;
  eventBus: EventBus;
  eventStore: EventStore;
  costCollector: RunCostCollector;
  query?: string;
  contextFences?: readonly unknown[];
  wakeSource?: string;
  ephemeral?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RunExecutorPort<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  execute(context: RunExecutionContext<TRequest>): Promise<RunOutcome | void>;
}

export interface RunRegistrationSpec<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  runId?: RunId;
  /** 同一 supervisor 内，活跃 run 不得共享同一个业务并发 key。 */
  concurrencyKey?: string;
  parentRunId?: RunId;
  parentSignal?: AbortSignal;
  conversationId: string;
  agentSpec: AgentSpec;
  request: TRequest;
  eventBus: EventBus;
  eventStore: EventStore;
  costCollector: RunCostCollector;
  iterationBudget?: RunRecord['iterationBudget'];
  query?: string;
  contextFences?: readonly unknown[];
  wakeSource?: string;
  ephemeral?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RunSupervisor<TRequest extends RunRequestSnapshot = RunRequestSnapshot> {
  registerRun(spec: RunRegistrationSpec<TRequest>): Promise<RunHandle<TRequest>>;
  spawnDetached(spec: RunRegistrationSpec<TRequest>): Promise<RunHandle<TRequest>>;
  observeRun(runId: RunId, filter?: RunObserveFilter): AsyncIterable<RuntimeEvent>;
  cancel(runId: RunId, opts: CancelOpts): Promise<void>;
  markAwaitingUser(runId: RunId, patch?: RunAwaitingUserPatch): Promise<void>;
  list(filter?: ListRunsFilter): Promise<{ runs: RunMeta[]; nextCursor?: string }>;
  peek(runId: RunId): Promise<RunMeta | null>;
  waitForTerminal(runId: RunId, opts?: RunWaitForTerminalOptions): Promise<RunOutcome>;
  findActiveByConversation(
    conversationId: string,
    opts?: FindActiveByConversationOptions
  ): Promise<RunSnapshot[]>;
  /**
   * 读取持久 registry 中的对话 run，包括终态和 metadata。
   * cleanup 恢复需要重新发现“已终态但后置清理未完成”的 owner，不能只依赖内存 handle。
   */
  findByConversation(
    conversationId: string,
    opts?: FindRunsByConversationOptions
  ): Promise<RunSnapshot[]>;
  drain(opts?: RunWaitForTerminalOptions): Promise<RunOutcome[]>;
  recoverOnBoot(reason?: string): Promise<RunOutcome[]>;
  pause(runId: RunId, reason?: string): Promise<never>;
  claimResume(
    runId: RunId,
    interaction: RunResumeInteraction,
    eventBus: EventBus,
    parentSignal?: AbortSignal
  ): Promise<RunResumeClaim<TRequest>>;
  runTree(rootRunId: RunId): Promise<never>;
  handleFailure(runId: RunId, error: unknown): Promise<never>;
}

export interface DefaultRunSupervisorOptions<
  TRequest extends RunRequestSnapshot = RunRequestSnapshot,
> {
  registryStore: RunRegistryStore;
  auditPort?: AuditPort;
  executor?: RunExecutorPort<TRequest>;
  runIdFactory?: () => RunId;
  now?: () => number;
  maxActiveRuns?: number;
}
