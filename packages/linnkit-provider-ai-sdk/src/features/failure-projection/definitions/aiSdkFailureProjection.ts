import type { CanonicalInferenceFailureKind } from '@linnlabs/linnkit/ports';
import type { LlmRetryCategory } from '@linnlabs/linnkit/contracts';

export interface AiSdkFailureProjection {
  readonly kind: CanonicalInferenceFailureKind;
  readonly code: string;
  readonly retryable: boolean;
  /** Adapter 解释已取得的供应商信号；框架只按通用类别治理预算，不猜供应商 code。 */
  readonly retry_category?: LlmRetryCategory;
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
