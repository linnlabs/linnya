import generatedBindings from '../../../generated/provider-runtime-bindings.generated.json';

import type {
  FormalProviderRuntimeBinding,
  FormalProviderRuntimeManifestRegistry,
} from '../definitions/formalProviderRuntimeManifest';
import { readFormalProviderRuntimeManifestSnapshot } from '../functions/readFormalProviderRuntimeManifestSnapshot';

const snapshot = readFormalProviderRuntimeManifestSnapshot(generatedBindings);
const bindingsByConnectionId = new Map<string, FormalProviderRuntimeBinding>(
  snapshot.bindings.map(binding => [binding.provider_connection_definition_id, binding])
);

export const formalProviderRuntimeManifestRegistry: FormalProviderRuntimeManifestRegistry =
  Object.freeze({
    ...snapshot,
    get: (providerConnectionDefinitionId: string) =>
      bindingsByConnectionId.get(providerConnectionDefinitionId),
  });
