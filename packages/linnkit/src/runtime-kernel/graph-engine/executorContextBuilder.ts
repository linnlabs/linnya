import type {
  AgentInvocationRequest,
  CanonicalInferenceCachePolicy,
  ImageInputAdmissionEvidence,
  LlmRequestMessage,
} from '../../ports';
import type { EffectivePromptBudget } from './functions/resolveEffectivePromptBudget';
import type {
  ContextBuildTokenEstimate,
  ContextCompactionCandidate,
  ContextCompactionPlan,
  ContextComponentTokenLedgerEntry,
  ContextTokenComponent,
  PromptUsageMeasurementPolicy,
  RuntimeEvent,
  HistorySummaryEvent,
  ResolvedContextCompactionPolicy,
} from '../../contracts';

export interface GraphExecutorOutputProcessor {
  /**
   * 中文备注：outputProcessor 来自 host task 实例，方法可能依赖 `this`。
   * runtime-kernel 调用时必须保留对象接收者，不要拆成裸函数传递。
   */
  processResponse?(this: GraphExecutorOutputProcessor, rawResponse: string): string;
  processStreamChunk?(this: GraphExecutorOutputProcessor, chunk: string): string;
}

export interface GraphExecutorContextBuildInput {
  request: AgentInvocationRequest;
  history: RuntimeEvent[];
  modelId: string;
  /** `prepare_call` 对最终 tools/control 的本地估算，Context Builder 必须先从输入预算扣除。 */
  toolDefinitionTokens: number;
  signal?: AbortSignal;
}

export interface GraphExecutorContextBuildOutput {
  llmMessages: LlmRequestMessage[];
  /** 当前正式主 Prompt 的稳定前缀锚点；由 Host 根据消息语义标注。 */
  cachePolicy?: CanonicalInferenceCachePolicy;
  /** 模型 route、Agent policy 与 prepared tools 合并后的单一预算事实。 */
  promptBudget?: EffectivePromptBudget;
  /** reminder 后最终 Prompt 计数必须遵守的 route、remote count 与 calibration 策略。 */
  promptUsageMeasurementPolicy?: PromptUsageMeasurementPolicy;
  /** Context Manager 产出的短生命周期图片预算证据；不得写入 checkpoint 或 provider options。 */
  imageInputAdmissionEvidence?: ImageInputAdmissionEvidence;
  /** 最终 Prompt 达阈值时，Graph 可消费的纯压缩计划。 */
  contextCompactionCandidate?: GraphContextCompactionCandidate;
  /** 即使当前没有可替换区段，Graph 仍需知道策略以正确结算硬超限。 */
  contextCompactionPolicy?: ResolvedContextCompactionPolicy;
  /**
   * Host 注入的输出文本处理器。
   *
   * 中文备注：
   * - runtime-kernel 只知道“把模型输出字符串交给一个可选函数处理”；
   * - 具体规则仍由 host 的 agent/task 定义提供，避免 framework 反向识别 promptKey 或产品语义。
   */
  outputProcessor?: GraphExecutorOutputProcessor;
  /**
   * 上下文构建旁路 trace。
   *
   * 中文备注：runtime-kernel 只负责透传，不理解 context-manager 的具体 trace 类型，
   * 避免 graph-engine 反向依赖 context-manager。
   */
  contextTrace?: unknown;
  /**
   * 构建期 token 估算快照。
   *
   * 中文备注：runtime-kernel 只透传稳定 DTO；它不解析 context-manager 内部 trace，
   * 也不把 provider remote count 当成本地估算样本来源。
   */
  tokenEstimate?: ContextBuildTokenEstimate;
  /**
   * 构建期上下文分项 token 估算。
   *
   * 中文备注：context-manager 只产稳定 DTO，runtime-kernel 在带 run/turn scope 的地方
   * 再创建账本条目，避免反向读取 ContextTrace 内部结构。
   */
  tokenComponents?: ContextTokenComponent[];
  tokenLedgerEntry?: ContextComponentTokenLedgerEntry;
}

export type GraphContextCompactionCandidate = ContextCompactionCandidate;

export interface GraphExecutorContextApplyInput extends GraphExecutorContextBuildInput {
  plan: ContextCompactionPlan;
  checkpointContent: string;
  summaryId: string;
  conversationId: string;
  turnId: string;
  timestamp: number;
  maxOutputTokens: number;
}

export type GraphExecutorContextApplyOutput =
  | {
      kind: 'ready';
      rebuiltContext: GraphExecutorContextBuildOutput;
      pendingSummaryEvent: HistorySummaryEvent;
      compressionRatio: number;
      summaryTokenEstimate: number;
    }
  | {
      kind: 'invalid';
      reason: string;
      tokenEstimate?: number;
      messageId?: string;
    }
  | {
      kind: 'ineffective';
      compressionRatio: number;
      summaryTokenEstimate: number;
    };

export interface GraphExecutorContextBuilder {
  build(input: GraphExecutorContextBuildInput): Promise<GraphExecutorContextBuildOutput>;
  applyCompaction?(
    input: GraphExecutorContextApplyInput,
  ): Promise<GraphExecutorContextApplyOutput>;
}
