import type { LanguageModelUsage } from 'ai';
import type { CanonicalLlmUsage } from '@linnlabs/linnkit/contracts';

function optionalCount(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`[AiSdkInference] AI SDK 标准 usage.${field} 必须是非负安全整数。`);
  }
  return value;
}

/**
 * raw 只作为“Provider 确实上报 usage”的 provenance 证据；数值语义全部由 Provider package
 * 投影到 AI SDK 标准字段。Host 不再识别 prompt_tokens、cache_read_input_tokens 等厂商字段。
 */
export function projectAiSdkUsage(usage: LanguageModelUsage): CanonicalLlmUsage | undefined {
  if (!usage.raw) return undefined;

  const inputTokens = optionalCount(
    usage.inputTokenDetails.noCacheTokens,
    'inputTokenDetails.noCacheTokens'
  );
  const outputTokens = optionalCount(usage.outputTokens, 'outputTokens');
  if (inputTokens === undefined || outputTokens === undefined) return undefined;

  const cacheReadTokens = optionalCount(
    usage.inputTokenDetails.cacheReadTokens,
    'inputTokenDetails.cacheReadTokens'
  );
  const cacheWriteTokens = optionalCount(
    usage.inputTokenDetails.cacheWriteTokens,
    'inputTokenDetails.cacheWriteTokens'
  );
  const reasoningTokens = optionalCount(
    usage.outputTokenDetails.reasoningTokens,
    'outputTokenDetails.reasoningTokens'
  );

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    source: 'provider-response-usage',
    confidence: 'actual',
    rawUsage: usage.raw,
  };
}
