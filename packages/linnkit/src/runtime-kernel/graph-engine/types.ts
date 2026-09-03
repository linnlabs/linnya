import type { ToolExecutionContext } from '../tools/toolExecutionContext';
import type {
  AgentSpecSystemReminderPolicy,
  AgentSpecToolObservationGovernancePolicy,
  ContextUsageSnapshot,
  RoutedRuntimeEvent,
  RunId,
  RuntimeEvent,
  SummarizationCallbacks,
  ToolCallId,
} from '../../contracts';

export type ExecutorLlmInvocationKind = 'user_initiated' | 'continuation';

export interface ExecutorLocalState {
  stepCount: number;
  phase?: 'running' | 'force_final_answer' | 'force_tools' | string;
  maxSteps?: number;
  remainingSteps?: number;
  finalStepPolicy?: 'final_answer' | 'force_tools';
  finalStepForcedTools?: string[];
  lastStepsHintThreshold?: number;
  systemReminderPolicy?: AgentSpecSystemReminderPolicy;
  toolObservationPolicy?: AgentSpecToolObservationGovernancePolicy;
  runLockedModelId?: string;
  /** 最近一次成功产生当前工具调用决策的真实 provider model。 */
  lastSuccessfulLlmModelId?: string;
  /**
   * 当前这一次 LLM 调用的业务来源。
   *
   * 中文备注：
   * - 该字段由 GraphExecutor 在进入 llm 节点前注入；
   * - prepareCallStage 只能读这个显式语义，不能再用 stepCount 推断是否续跑；
   * - user_initiated 表示本 run 第一次 LLM 调用，continuation 表示工具/恢复后的后续 LLM 调用。
   */
  llmInvocationKind?: ExecutorLlmInvocationKind;
  /**
   * GraphExecutor 内部维护的 LLM 调用次数。
   *
   * 中文备注：
   * - 它用于 child-run 直接从 llm 启动时稳定推导 llmInvocationKind；
   * - 业务逻辑不要直接修改它。
   */
  llmInvocationCount?: number;
  /**
   * 固定模型运行时约束。
   *
   * 中文备注：
   * - 这是执行期策略，不是业务状态；用于工具内部子 agent 等必须使用确定模型的场景；
   * - 为 true 时，LLM 层不得 policy switch，也不得走 cloud quota fallback。
   */
  lockRequestedModelId?: boolean;
  /** 当前 run 的压缩调用次数、成功提交次数与最近已提交计划身份。 */
  contextCompaction?: {
    attemptCount: number;
    committedCount: number;
    lastCommittedFingerprint?: string;
  };
}

export type ExecutorLocalPatch = Partial<
  Pick<
    ExecutorLocalState,
    'runLockedModelId' | 'lastSuccessfulLlmModelId' | 'contextCompaction'
  >
>;

export interface EngineLocalState extends Record<string, unknown> {
  runId?: RunId;
  parentRunId?: RunId;
  conversationId?: string;
  turnId?: string;
  request?: Record<string, unknown>;
  toolContext?: ToolExecutionContext;
  history?: RuntimeEvent[];
  newEvents?: RuntimeEvent[];
  executorLocal?: ExecutorLocalState;
  pendingToolCalls?: StandardToolCall[];
  pendingInteractionSpec?: Record<string, unknown>;
  lastToolResult?: Record<string, unknown>;
  finalAnswer?: string;
  answerId?: string;
  chunkSeq?: number;
  signal?: AbortSignal;
  runtimeEventSink?: RuntimeEventSink;
  /** 在 fan-out 前请求 Host 持久化单个 durable fact。 */
  runtimeEventCommitPort?: RuntimeEventCommitPort;
  runtimeFailureFactSink?: RuntimeFailureFactSink;
  summarizationCallbacks?: SummarizationCallbacks;
  /** 最近一次成功完成的 LLM Prompt 占用；可序列化并随 checkpoint 保留。 */
  contextUsage?: ContextUsageSnapshot;
}

/** Graph 节点发布标准事实的唯一出口；返回值是 admission 附着身份后的同一事实。 */
export type RuntimeEventSink = (event: RuntimeEvent, source: string) => RoutedRuntimeEvent;

/**
 * Graph 在 fan-out 前请求 Host 提交一条 durable RuntimeEvent。
 *
 * Host 必须先完成 run admission 与落盘，并标记随后的正常
 * RuntimeEventSink publish 不重复写库；本 port 自身不做 realtime fan-out。
 */
export type RuntimeEventCommitPort = (event: RuntimeEvent, source: string) => Promise<void>;

/** 已经通过 RuntimeEventSink admission 并发布的执行终态错误事实。 */
export type RuntimeFailureFact = Extract<RoutedRuntimeEvent, { type: 'error' }> & {
  error_code: string;
  retryable: boolean;
};

/** Graph 将已发布的终态错误事实交给 Host lifecycle；只观察事实，不拥有发布或结算。 */
export type RuntimeFailureFactSink = (event: RuntimeFailureFact) => void;

export const ENGINE_STATE_SCHEMA_VERSION = 1;

export interface EngineState {
  nodeId: string;
  /**
   * 当前 checkpoint 的单调版本。
   *
   * start/resume session 通过它拒绝重复或过期恢复；每次持久化都会递增。
   */
  revision?: number;
  /**
   * 顶层 schema version，供持久化后端在不解读 local 结构时也能快速判断版本。
   *
   * 当前 save 路径会统一写入该字段；类型先保持向后兼容，直到旧测试/fixture 全部收敛。
   */
  schemaVersion?: number;
  local?: EngineLocalState;
}

export interface NodeResult {
  kind: 'route' | 'yield' | 'pause';
  nextNodeId?: string;
  events?: RoutedRuntimeEvent[];
}

export interface GraphNode {
  id: string;
  run(state: EngineState): Promise<NodeResult>;
}

export interface StandardToolCall {
  id: ToolCallId;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}
