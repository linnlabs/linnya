import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';

type InferenceFailure = Extract<CanonicalInferenceEvent, { type: 'failure' }>;

/** 只记录政策改变的资格，不把 SDK 原事件或连接对象整体带进日志。 */
export interface ProviderFailurePolicyApplication {
  readonly type: 'policy_applied';
  readonly policy_id: 'opencode_go_unknown_http400_probe';
  readonly provider_connection_definition_id: 'opencode-go';
  readonly original_failure: Pick<InferenceFailure, 'kind' | 'code' | 'retryable'>;
  readonly effective_failure: Pick<InferenceFailure, 'kind' | 'code' | 'retryable' | 'retry_category'>;
}

export interface ProviderFailurePolicyProjection {
  readonly event: CanonicalInferenceEvent;
  readonly application?: ProviderFailurePolicyApplication;
}
