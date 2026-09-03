export type FallbackPromptCapacityRejectionReason =
  | 'fallback_inference_route_missing'
  | 'fallback_output_limit_unsupported'
  | 'fallback_context_window_exceeded';

export type FallbackPromptCapacityAdmission =
  | { admitted: true }
  | { admitted: false; reason: FallbackPromptCapacityRejectionReason };

export function evaluateFallbackPromptCapacity(input: {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  requiredOutputLimitTokens: number;
  estimatedPromptTokens: number;
}): FallbackPromptCapacityAdmission {
  if (input.contextWindowTokens === undefined || input.maxOutputTokens === undefined) {
    return { admitted: false, reason: 'fallback_inference_route_missing' };
  }
  if (input.maxOutputTokens < input.requiredOutputLimitTokens) {
    return { admitted: false, reason: 'fallback_output_limit_unsupported' };
  }
  if (input.estimatedPromptTokens + input.requiredOutputLimitTokens > input.contextWindowTokens) {
    return { admitted: false, reason: 'fallback_context_window_exceeded' };
  }
  return { admitted: true };
}
