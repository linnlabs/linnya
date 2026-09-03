import type { CanonicalInferenceFailureKind } from '@linnlabs/linnkit/ports';

export interface AiSdkFailureProjection {
  readonly kind: CanonicalInferenceFailureKind;
  readonly code: string;
  readonly retryable: boolean;
}

export type AiSdkFailurePhase = 'provider_call' | 'request_projection' | 'provider_stream';

export interface AiSdkProviderFailureCandidate {
  readonly phase: AiSdkFailurePhase;
  readonly kind: 'api_call' | 'decoded_stream';
  readonly status_code?: number;
  readonly code?: string;
  readonly type?: string;
  readonly reason?: string;
  /** 只供 Host 产品规则分类；禁止记录或写入 canonical failure。 */
  readonly response_body?: string;
}

export interface AiSdkProviderFailureClassifier {
  classify(candidate: AiSdkProviderFailureCandidate): AiSdkFailureProjection | undefined;
}
