import type { ContextUsageSnapshot } from '../../../contracts';
import type { ImageInputAdmissionEvidence, LlmRequestMessage } from '../../../ports';
import type { ModelInputRequirement } from '../input-capabilities';
import type { ToolCallStreamingPolicy } from '../../tools/toolContracts';
import type { FallbackPromptCapacityAdmission } from '../functions/evaluateFallbackPromptCapacity';

/**
 * 单次 LLM 调用的短生命周期上下文。
 *
 * 中文备注：这里的信息只参与 runtime preflight，不能混入 LlmCallOptions，
 * 否则 provider request builder 可能把内部预算证据原样发到外部服务。
 */
export interface LlmCallInvocationContext {
  readonly imageInputAdmissionEvidence?: ImageInputAdmissionEvidence;
  /** 来自本次实际暴露工具的静态输入要求，不会进入 provider options。 */
  readonly additionalModelInputRequirement?: ModelInputRequirement;
  /**
   * 本次实际暴露工具的流式生命周期声明。
   * 该调用上下文不会进入 provider options，请求适配器不得接触此字段。
   */
  readonly toolCallStreamingPolicies?: Readonly<Record<string, ToolCallStreamingPolicy>>;
  /** 每个真实 provider attempt 发送前，按 active route 测量最终 Prompt。 */
  readonly measurePromptUsage?: (
    activeModelId: string,
    messages: readonly LlmRequestMessage[],
  ) => Promise<ContextUsageSnapshot>;
  /** fallback candidate 在真实 attempt 前的本地容量 admission。 */
  readonly evaluateFallbackPromptCapacity?: (
    candidateModelId: string,
  ) => FallbackPromptCapacityAdmission;
}
