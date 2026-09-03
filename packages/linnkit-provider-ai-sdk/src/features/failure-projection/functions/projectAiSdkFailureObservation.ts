import {
  AISDKError,
  APICallError,
  EmptyResponseBodyError,
  InvalidResponseDataError,
  JSONParseError,
  StreamProviderError,
  TypeValidationError,
  UnsupportedFunctionalityError,
} from 'ai';

import type {
  AiSdkFailureErrorShape,
  AiSdkFailureObservation,
} from '../definitions/aiSdkFailureObservation';
import type {
  AiSdkFailurePhase,
  AiSdkProviderFailureClassifier,
} from '../definitions/aiSdkFailureProjection';
import { AiSdkHostStreamInvariantError } from '../definitions/aiSdkHostStreamInvariantError';
import { classifyAiSdkFailure } from './classifyAiSdkFailure';

function readSafeErrorShape(error: unknown): AiSdkFailureErrorShape {
  if (error instanceof AiSdkHostStreamInvariantError) return 'host_stream_invariant';
  if (APICallError.isInstance(error)) return 'api_call_error';
  if (TypeValidationError.isInstance(error) || InvalidResponseDataError.isInstance(error)) {
    return 'response_schema_error';
  }
  if (JSONParseError.isInstance(error)) return 'response_json_error';
  if (EmptyResponseBodyError.isInstance(error)) return 'empty_response_error';
  if (UnsupportedFunctionalityError.isInstance(error)) {
    return 'unsupported_functionality_error';
  }
  if (error instanceof TypeError) return 'transport_type_error';
  if (StreamProviderError.isInstance(error)) return 'stream_provider_error';
  if (AISDKError.isInstance(error)) return 'ai_sdk_error';
  if (typeof error === 'object' && error !== null && !(error instanceof Error)) {
    return 'decoded_provider_error';
  }
  if (error instanceof Error) return 'plain_error';
  return 'unknown_thrown_value';
}

export function projectAiSdkFailureObservation(
  error: unknown,
  signal: AbortSignal | undefined,
  phase: AiSdkFailurePhase,
  providerClassifier?: AiSdkProviderFailureClassifier
): AiSdkFailureObservation {
  return {
    failure: classifyAiSdkFailure(error, signal, phase, providerClassifier),
    diagnostic: { phase, error_shape: readSafeErrorShape(error) },
  };
}
