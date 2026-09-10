import type { AiSdkFailurePhase, AiSdkFailureProjection } from './aiSdkFailureProjection';

export type AiSdkFailureErrorShape =
  | 'host_stream_invariant'
  | 'api_call_error'
  | 'response_schema_error'
  | 'response_json_error'
  | 'empty_response_error'
  | 'unsupported_functionality_error'
  | 'transport_type_error'
  | 'stream_provider_error'
  | 'ai_sdk_error'
  | 'decoded_provider_error'
  | 'plain_error'
  | 'unknown_thrown_value';

/** Provider 只读的判别字段；不得包含 message、request body 或 response body。 */
export interface AiSdkProviderSignal {
  readonly status_code?: number;
  readonly type?: string;
  readonly code?: string;
  readonly reason?: string;
}

export interface AiSdkFailureObservation {
  readonly failure: AiSdkFailureProjection;
  /** 仅包含白名单字段，禁止携带 Error message、Provider body 或 URL。 */
  readonly diagnostic: {
    readonly phase: AiSdkFailurePhase;
    readonly error_shape: AiSdkFailureErrorShape;
    readonly provider_signal?: AiSdkProviderSignal;
  };
}
