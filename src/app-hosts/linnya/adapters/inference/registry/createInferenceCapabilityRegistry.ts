import type {
  InferenceCapability,
  InferenceCapabilityRegistry,
} from '../definitions/inferenceCapability';

export function createInferenceCapabilityRegistry(
  capabilities: readonly InferenceCapability[]
): InferenceCapabilityRegistry {
  const byId = new Map<string, InferenceCapability>();
  for (const capability of capabilities) {
    if (byId.has(capability.id)) {
      throw new Error(`Duplicate inference capability id: ${capability.id}`);
    }
    byId.set(capability.id, capability);
  }
  return {
    get(capabilityId) {
      return byId.get(capabilityId);
    },
  };
}
