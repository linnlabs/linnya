import { getModelCapabilities } from '@ai-sdk/anthropic/internal';
import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';

/**
 * SDK internal 依赖仅留在 Anthropic owner，随精确版本和真实 codec 一起验收。
 * SDK 未提供旧版 extended thinking 的正向能力标记，因此不能从容量或未知模型默认值猜测。
 */
export function resolveAnthropicModelReasoning(
  endpointModelId: string
): ModelReasoningConfig | undefined {
  const capabilities = getModelCapabilities(endpointModelId);
  if (!capabilities.isKnownModel || !capabilities.supportsAdaptiveThinking) return undefined;

  return {
    supported_efforts: [
      // between_tools 仍会思考，不能把它向用户声明成关闭。
      ...(!capabilities.rejectsThinkingDisabled ? ['off' as const] : []),
      'low',
      'medium',
      'high',
      ...(capabilities.supportsXhighEffort ? ['xhigh' as const] : []),
    ],
  };
}
