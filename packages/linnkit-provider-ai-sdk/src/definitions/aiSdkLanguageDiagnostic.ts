import type {
  AiSdkFailureErrorShape,
  AiSdkFailurePhase,
} from '../features/failure-projection';
import type { AiSdkInferenceCapabilityId } from './aiSdkCapabilityIds';
import type { AiSdkInferenceSurface } from './aiSdkInferenceSurface';

export type AiSdkLanguageDiagnostic =
  | {
      readonly type: 'failure_projected';
      readonly phase: AiSdkFailurePhase;
      readonly error_shape: AiSdkFailureErrorShape;
      readonly failure_kind: string;
      readonly failure_code: string;
      readonly retryable: boolean;
    }
  | {
      readonly type: 'nonstandard_finish';
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
      readonly capability_id: AiSdkInferenceCapabilityId;
      readonly surface: AiSdkInferenceSurface;
      readonly idle_timeout_ms: number;
    };

export interface AiSdkLanguageDiagnosticSink {
  publish(diagnostic: AiSdkLanguageDiagnostic): void;
}
