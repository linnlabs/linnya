import type { ModelRoutingPolicy } from '../definitions/modelRoutingDecision';
import { decideModelSwitch } from '../functions/decideModelSwitch';
import { readCanonicalInferenceFailureCode } from '../functions/readCanonicalInferenceFailureCode';

export function createDefaultModelRoutingPolicy(): ModelRoutingPolicy {
  return {
    decideOnError(error) {
      return decideModelSwitch(readCanonicalInferenceFailureCode(error));
    },
  };
}

export const defaultModelRoutingPolicy = createDefaultModelRoutingPolicy();
