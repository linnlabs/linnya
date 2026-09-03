import type { LLMPolicyErrorDecision } from 'linnkit/runtime-kernel';
import {
  MODEL_ROUTABLE_INFERENCE_FAILURE_CODES,
  type ModelRoutableInferenceFailureCode,
} from '../../inference';

const SWITCH_REASONS: Readonly<Record<ModelRoutableInferenceFailureCode, string>> = {
  [MODEL_ROUTABLE_INFERENCE_FAILURE_CODES.PROVIDER_LOCATION_RESTRICTED]:
    'selected provider route is unavailable in the current location',
  [MODEL_ROUTABLE_INFERENCE_FAILURE_CODES.PROVIDER_CONTINUATION_REJECTED]:
    'provider rejected the structured continuation',
};

export function decideModelSwitch(failureCode: string | undefined): LLMPolicyErrorDecision {
  switch (failureCode) {
    case MODEL_ROUTABLE_INFERENCE_FAILURE_CODES.PROVIDER_LOCATION_RESTRICTED:
    case MODEL_ROUTABLE_INFERENCE_FAILURE_CODES.PROVIDER_CONTINUATION_REJECTED:
      return { action: 'switch_model', reason: SWITCH_REASONS[failureCode] };
    default:
      return { action: 'none' };
  }
}
