import type {
  AgentInvocationRequest,
  ImageInputAdmissionEvidence,
  LlmRequestMessage,
  TokenizerPort,
  ToolCall,
} from '../../../ports';
import type {
  AnyAgentEvent,
  FinalAnswerEvent,
  ToolCallDecisionEvent,
} from '../../events/agentEvents';
import type { ToolExecutionContext } from '../../tools/toolExecutionContext';
import type { FunctionToolSchema } from '../../tools/toolContracts';
import type { ToolCallStreamingPolicy } from '../../tools/toolContracts';
import type { LlmCallOptions } from '../../llm/caller';
import type { ModelInputRequirement } from '../../llm/input-capabilities';
import type { TelemetryPort } from '../../telemetry/telemetryPort';
import type { AuditPort } from '../../../ports';
import type {
  ExecutorLocalPatch,
  ExecutorLocalState,
  RuntimeEventCommitPort,
  StandardToolCall,
} from '../types';
import type { GraphExecutorOutputProcessor } from '../executorContextBuilder';
import type { GraphContextCompactionCandidate } from '../executorContextBuilder';
import type { EffectivePromptBudget } from '../functions/resolveEffectivePromptBudget';
import type {
  CanonicalLlmUsage,
  AssistantReplayPart,
  ContextUsageSnapshot,
  ContextCompactionPlan,
  ResolvedContextCompactionPolicy,
  HistorySummaryEvent,
  PromptUsageMeasurementPolicy,
  ProviderContinuation,
  RuntimeEvent,
  SerializableJsonRecord,
  SummarizationCallbacks,
} from '../../../contracts';

export interface ModelFallbackAudit {
  fromModelId: string;
  toModelId: string;
  reason: string;
  policy: 'policy-switch' | 'cloud-quota';
}

export type TickEvent = AnyAgentEvent | RuntimeEvent;

export type AgentStepDecision =
  | { kind: 'tool_calls'; toolCalls: StandardToolCall[] }
  | { kind: 'final_answer'; answer: string }
  | {
      kind: 'wait_user';
      pendingInteractionSpec: Record<string, unknown>;
      lastToolResult: Record<string, unknown>;
    }
  | { kind: 'yield' }
  | { kind: 'error'; error: Error };

export interface TickInput {
  request: AgentInvocationRequest;
  toolContext?: ToolExecutionContext;
  stream?: boolean;
  history: RuntimeEvent[];
  signal?: AbortSignal;
  /**
   * 🔥 达到最大步数时的强制收尾开关：
   * - true 时：禁用工具（不下发 tools schema，tool_choice=none）
   * - 并注入 system 指令，要求模型必须直接输出最终答案
   */
  forceFinalAnswer?: boolean;
  /**
   * 执行阶段信号（由 GraphExecutor 注入到 local.executorLocal）
   *
   * 中文备注：
   * - SystemReminder 引擎会基于它生成 <system-reminder> 并追加到最后一条消息末尾
   * - 该字段仅用于“本次 tick 的 LLM 输入”，不得写入历史事件或持久化
   */
  executorLocal?: ExecutorLocalState;
  summarizationCallbacks?: SummarizationCallbacks;
  runtimeEventCommitPort?: RuntimeEventCommitPort;
}

export interface TickOutput {
  decision: AgentStepDecision;
  executorLocalPatch?: ExecutorLocalPatch;
  contextTrace?: SerializableJsonRecord;
  contextUsage?: ContextUsageSnapshot;
}

export type LlmCallResponse =
  | string
  | {
      content: string;
      tool_calls?: ToolCall[];
      provider_continuations?: ProviderContinuation[];
      assistant_replay_parts?: AssistantReplayPart[];
      canonicalUsage?: CanonicalLlmUsage;
    };

export interface TickPipelineContext {
  input: TickInput;
  eventHandler?: (event: TickEvent) => void;
  request: AgentInvocationRequest;
  history: RuntimeEvent[];
  signal?: AbortSignal;
  forceFinalAnswer: boolean;
  executorLocal?: ExecutorLocalState;
  executorLocalPatch?: ExecutorLocalPatch;
  summarizationCallbacks?: SummarizationCallbacks;
  runtimeEventCommitPort?: RuntimeEventCommitPort;
  modelId: string;
  toolSchemas: FunctionToolSchema[];
  toolModelInputRequirement?: ModelInputRequirement;
  toolCallStreamingPolicies: Readonly<Record<string, ToolCallStreamingPolicy>>;
  llmOptions: LlmCallOptions;
  toolDefinitionTokens: number;
  promptBudget?: EffectivePromptBudget;
  promptUsageMeasurementPolicy?: PromptUsageMeasurementPolicy;
  promptUsageCandidate?: ContextUsageSnapshot;
  contextUsage?: ContextUsageSnapshot;
  llmMessages: LlmRequestMessage[];
  imageInputAdmissionEvidence?: ImageInputAdmissionEvidence;
  contextCompactionCandidate?: GraphContextCompactionCandidate;
  contextCompactionPolicy?: ResolvedContextCompactionPolicy;
  pendingContextCompaction?: {
    attemptIndex: number;
    plan: ContextCompactionPlan;
    policy: ResolvedContextCompactionPolicy;
    modelId: string;
    event: HistorySummaryEvent;
    compressionRatio: number;
    summaryTokenCount: number;
    compactionInputTokens: number;
    compactionDurationMs: number;
    canonicalUsage?: CanonicalLlmUsage;
    forcedPhaseRecovery: boolean;
    targetUnreachable: boolean;
    usageBefore: ContextUsageSnapshot;
    usageAfter: ContextUsageSnapshot;
  };
  conversationId: string;
  turnId: string;
  llmCallStartedAt?: number;
  llmCallDurationMs?: number;
  llmResp?: LlmCallResponse;
  outputProcessor?: GraphExecutorOutputProcessor;
  decision?: AgentStepDecision;
  systemReminderHitRuleIds?: string[];
  contextTrace?: SerializableJsonRecord;
  cloudQuotaFallbackAppliedModelId?: string;
  modelFallbackAudit?: ModelFallbackAudit;
  /**
   * 由 GraphAgentExecutor 注入；middleware/stage 通过 ctx.telemetry.emit() 上报观测事件。
   * 默认 noopTelemetry，宿主侧可注入实际 sink（如 SQLite / OTEL / 自定义日志适配器）。
   */
  telemetry: TelemetryPort;
  audit: AuditPort;
  /**
   * LLM telemetry 本地估算也必须走 TokenizerPort，避免绕过 host 注入的 tokenizer。
   */
  tokenizer: TokenizerPort;
}

export type TickStageId =
  | 'prepare_call'
  | 'build_context'
  | 'apply_system_reminder'
  | 'measure_prompt_usage'
  | 'compact_context'
  | 'admit_prompt_capacity'
  | 'commit_context_compaction'
  | 'execute_llm'
  | 'build_decision';

export type TickStageContextKey = keyof TickPipelineContext;
export type TickStageContextPatch = Partial<Pick<TickPipelineContext, TickStageContextKey>>;

export type TickStagePatch = TickStageContextPatch;

export type TickStagePatchFor<WriteKeys extends TickStageContextKey> = Partial<
  Pick<TickPipelineContext, WriteKeys>
>;

export interface TickMiddlewarePatch {
  /**
   * middleware 只能产出执行器级窄 patch；由 runner 统一合并。
   *
   * 中文备注：这避免 middleware 在横切逻辑里直接改共享 ctx，
   * 也避免把 EngineState.local.executorLocal 当成可变 store。
   */
  executorLocalPatch?: ExecutorLocalPatch;
}

export interface TickStage {
  id: TickStageId;
  /**
   * Q-R2 过渡契约：stage 仍接收完整 ctx，但必须显式声明自己依赖和产出的顶层字段。
   * 后续 patch 化时 runner 会用这份契约收窄输入/输出，而不是让 stage 自由读写共享袋。
   */
  reads: readonly TickStageContextKey[];
  writes: readonly TickStageContextKey[];
  run(ctx: TickPipelineContext): Promise<TickStagePatch | void>;
}

export function defineTickStage<
  const Reads extends readonly TickStageContextKey[],
  const Writes extends readonly TickStageContextKey[],
>(stage: {
  id: TickStageId;
  reads: Reads;
  writes: Writes;
  run(
    ctx: Readonly<Pick<TickPipelineContext, Reads[number]>>
  ): Promise<TickStagePatchFor<Writes[number]> | void>;
}): TickStage {
  return stage as TickStage;
}

export type TickStageRunner = () => Promise<void>;

export type TickAroundMiddleware = (
  ctx: TickPipelineContext,
  stage: TickStage,
  next: TickStageRunner
) => Promise<TickMiddlewarePatch | void>;

export type TickDecisionEvent = FinalAnswerEvent | ToolCallDecisionEvent;
