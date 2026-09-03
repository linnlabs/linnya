import type {
  CanonicalCompletedToolCall,
  CanonicalInferenceEvent,
  CanonicalInferenceRequest,
  ProviderContinuation,
} from 'linnkit/ports';
import type { ResolvedInferenceAttemptRoute } from '../definitions/inferenceCapability';
import {
  INFERENCE_ADMISSION_ERROR_CODES,
  InferenceAdmissionError,
} from '../definitions/inferenceAdmissionError';

function assertContinuationRoute(
  continuation: ProviderContinuation,
  route: ResolvedInferenceAttemptRoute
): void {
  const producer = continuation.producer;
  if (
    producer.model_id !== route.model_id ||
    producer.endpoint_id !== route.endpoint_id ||
    producer.api_surface !== route.api_surface ||
    producer.capability_id !== route.capability_id ||
    producer.endpoint_model_id !== route.endpoint_model_id
  ) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.EVENT_ROUTE_MISMATCH,
      'Provider continuation producer does not match the selected inference route.'
    );
  }
}

function assertToolCallRoute(
  call: CanonicalCompletedToolCall,
  route: ResolvedInferenceAttemptRoute
): void {
  call.continuation?.forEach(continuation => assertContinuationRoute(continuation, route));
}

export function assertInferenceEventRoute(
  event: CanonicalInferenceEvent,
  request: CanonicalInferenceRequest,
  route: ResolvedInferenceAttemptRoute
): void {
  if (
    event.type === 'start' &&
    (event.model_id !== request.model_id || event.attempt_id !== request.invocation.attempt_id)
  ) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.EVENT_ROUTE_MISMATCH,
      'Inference start event does not match the selected model and attempt.'
    );
  }
  if (event.type === 'assistant_part_end') {
    event.part.continuation?.forEach(value => assertContinuationRoute(value, route));
  }
  if (event.type === 'tool_call_end') {
    assertToolCallRoute(event.call, route);
  }
  if (event.type === 'usage' && route.usage.response_usage === 'unavailable') {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.USAGE_UNAVAILABLE,
      'Inference route emitted usage although response usage is declared unavailable.'
    );
  }
}
