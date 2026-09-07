import type {
  AiSdkFailureErrorShape,
  AiSdkFailurePhase,
} from '../features/failure-projection';
import type { AiSdkInferenceCapabilityId } from './aiSdkCapabilityIds';
import type { AiSdkInferenceSurface } from './aiSdkInferenceSurface';

export type AiSdkLanguageDiagnostic =
  | {
      readonly type: 'attempt_observed';
      readonly attempt_id: string;
      readonly capability_id: AiSdkInferenceCapabilityId;
      readonly surface: AiSdkInferenceSurface;
      readonly endpoint_id: string;
      readonly endpoint_model_id: string;
      readonly request_fingerprint: string;
      readonly message_count: number;
      readonly message_roles: Readonly<{
        readonly system: number;
        readonly user: number;
        readonly assistant: number;
        readonly tool: number;
      }>;
      readonly image_message_roles: Readonly<{
        readonly system: number;
        readonly user: number;
        readonly assistant: number;
        readonly tool: number;
      }>;
      readonly tool_count: number;
      readonly text_characters: number;
      readonly estimated_input_tokens: number;
      readonly image_count: number;
      readonly image_bytes: number;
      readonly image_media_types: readonly string[];
      readonly retry_count: number;
      readonly terminal_event_received: boolean;
      readonly terminal_event_type?: 'finish' | 'failure';
      readonly last_provider_part_type?: string;
    }
  | {
      readonly type: 'failure_projected';
      readonly attempt_id?: string;
      readonly request_fingerprint?: string;
      readonly phase: AiSdkFailurePhase;
      readonly error_shape: AiSdkFailureErrorShape;
      readonly failure_kind: string;
      readonly failure_code: string;
      readonly retryable: boolean;
    }
  | {
      readonly type: 'nonstandard_finish';
      readonly attempt_id?: string;
      readonly request_fingerprint?: string;
      readonly capability_id: AiSdkInferenceCapabilityId;
      readonly surface: AiSdkInferenceSurface;
      readonly finish_reason: 'error' | 'other';
      readonly raw_finish_reason_category: string;
      readonly projected_event_type: 'finish' | 'failure';
      readonly projected_code?: string;
      readonly projected_reason?: string;
      readonly retryable?: boolean;
    }
  | {
      readonly type: 'stream_idle_timeout';
      readonly attempt_id?: string;
      readonly request_fingerprint?: string;
      readonly capability_id: AiSdkInferenceCapabilityId;
      readonly surface: AiSdkInferenceSurface;
      readonly idle_timeout_ms: number;
    };

export interface AiSdkLanguageDiagnosticSink {
  publish(diagnostic: AiSdkLanguageDiagnostic): void;
}
