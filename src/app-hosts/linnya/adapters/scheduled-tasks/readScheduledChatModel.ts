import type { ModelCatalog } from 'src/domains/model-catalog';
import type { ProviderAccountRegistry } from 'src/domains/provider-account';
import { evaluateModelRuntimeAvailability } from '../../application/model-runtime-availability';

export function createScheduledChatModelAvailability(
  catalog: Pick<ModelCatalog, 'getModel' | 'getInferenceEndpoints' | 'hasCredential'>,
  accounts: Pick<ProviderAccountRegistry, 'hasCredential'>,
  unavailable: boolean,
): (modelId: string) => boolean {
  return modelId => {
    const model = unavailable ? undefined : catalog.getModel(modelId);
    return model !== undefined && evaluateModelRuntimeAvailability({ model, capability: 'chat', context: {
      inferenceEndpoints: catalog.getInferenceEndpoints(),
      hasModelCredential: id => catalog.hasCredential(id),
      hasProviderAccountCredential: id => accounts.hasCredential(id),
    } }).available;
  };
}
