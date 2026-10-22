import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';
import type { ProviderFailurePolicyProjection } from '../definitions/providerFailurePolicy';

/**
 * 正式连接范围内的容错试用，不是“400 已被证明是网络错误”。
 * 在 SDK 精确分类之后处理残余400，明确拒绝不能被这条宽松政策覆盖。
 */
export function projectProviderFailurePolicy(input: {
  readonly event: CanonicalInferenceEvent;
  readonly provider_connection_definition_id?: string;
  readonly aborted: boolean;
}): ProviderFailurePolicyProjection {
  const event = input.event;
  if (
    input.aborted ||
    input.provider_connection_definition_id !== 'opencode-go' ||
    event.type !== 'failure' ||
    event.kind !== 'provider' ||
    event.code !== 'provider_http_400' ||
    event.retryable
  ) {
    return { event };
  }
  return {
    event: { ...event, retryable: true, retry_category: 'other' },
    application: {
      type: 'policy_applied',
      policy_id: 'opencode_go_unknown_http400_probe',
      provider_connection_definition_id: 'opencode-go',
      original_failure: { kind: event.kind, code: event.code, retryable: event.retryable },
      effective_failure: {
        kind: event.kind,
        code: event.code,
        retryable: true,
        retry_category: 'other',
      },
    },
  };
}
