import type { FinishReason } from 'ai';
import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';

type CanonicalTerminalEvent = Extract<
  CanonicalInferenceEvent,
  { readonly type: 'finish' | 'failure' }
>;

export type AiSdkRawFinishReasonCategory =
  | 'none'
  | 'max_output_tokens'
  | 'max_tokens'
  | 'content_filter'
  | 'rate_limit_error'
  | 'overloaded'
  | 'server_error'
  | 'service_unavailable'
  | 'upstream_error'
  | 'timeout'
  | 'timed_out'
  | 'unrecognized';

export interface AiSdkFinishReasonProjection {
  readonly event: CanonicalTerminalEvent;
  readonly raw_reason_category: AiSdkRawFinishReasonCategory;
}

const RAW_FINISH_REASON_CATEGORIES: Readonly<
  Record<string, Exclude<AiSdkRawFinishReasonCategory, 'none' | 'unrecognized'>>
> = {
  max_output_tokens: 'max_output_tokens',
  max_tokens: 'max_tokens',
  content_filter: 'content_filter',
  rate_limit_error: 'rate_limit_error',
  overloaded: 'overloaded',
  server_error: 'server_error',
  service_unavailable: 'service_unavailable',
  upstream_error: 'upstream_error',
  timeout: 'timeout',
  timed_out: 'timed_out',
};

function categorizeRawFinishReason(
  rawFinishReason: string | undefined
): AiSdkRawFinishReasonCategory {
  if (rawFinishReason === undefined || rawFinishReason.trim().length === 0) return 'none';
  const normalized = rawFinishReason.trim().toLowerCase();
  return RAW_FINISH_REASON_CATEGORIES[normalized] ?? 'unrecognized';
}

function finish(reason: 'stop' | 'length' | 'tool_use' | 'content_filter'): CanonicalTerminalEvent {
  return { type: 'finish', reason };
}

function providerFailure(code: string): CanonicalTerminalEvent {
  return { type: 'failure', kind: 'provider', code, retryable: true };
}

/**
 * AI SDK 已经完成协议解码，`other` 是 Provider 结束语义，不是 JSON/SSE wire 损坏。
 * 兼容网关仍可能沿用 Responses 早期的 `max_tokens` 名称，因此在 Host 边界做窄别名投影；
 * Provider 私有原始值不得进入 Linnkit 的通用合同或日志。
 */
export function projectAiSdkFinishReason(
  finishReason: FinishReason,
  rawFinishReason: string | undefined
): AiSdkFinishReasonProjection {
  const rawReasonCategory = categorizeRawFinishReason(rawFinishReason);

  switch (finishReason) {
    case 'stop':
      return { event: finish('stop'), raw_reason_category: rawReasonCategory };
    case 'length':
      return { event: finish('length'), raw_reason_category: rawReasonCategory };
    case 'content-filter':
      return { event: finish('content_filter'), raw_reason_category: rawReasonCategory };
    case 'tool-calls':
      return { event: finish('tool_use'), raw_reason_category: rawReasonCategory };
    case 'other':
      if (rawReasonCategory === 'max_output_tokens' || rawReasonCategory === 'max_tokens') {
        return { event: finish('length'), raw_reason_category: rawReasonCategory };
      }
      if (rawReasonCategory === 'content_filter') {
        return { event: finish('content_filter'), raw_reason_category: rawReasonCategory };
      }
      if (rawReasonCategory === 'rate_limit_error') {
        return {
          event: providerFailure('provider_stream_rate_limited'),
          raw_reason_category: rawReasonCategory,
        };
      }
      if (rawReasonCategory === 'timeout' || rawReasonCategory === 'timed_out') {
        return {
          event: providerFailure('provider_stream_timeout'),
          raw_reason_category: rawReasonCategory,
        };
      }
      if (
        rawReasonCategory === 'overloaded'
        || rawReasonCategory === 'server_error'
        || rawReasonCategory === 'service_unavailable'
        || rawReasonCategory === 'upstream_error'
      ) {
        return {
          event: providerFailure('provider_stream_unavailable'),
          raw_reason_category: rawReasonCategory,
        };
      }
      return {
        event: providerFailure('provider_finish_other'),
        raw_reason_category: rawReasonCategory,
      };
    case 'error':
      return {
        event: providerFailure('provider_finish_error'),
        raw_reason_category: rawReasonCategory,
      };
  }
}
