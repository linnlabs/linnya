import {
  createAiSdkLanguageModelRegistry,
  type AiSdkLanguageModelFactoryInput,
  type AiSdkLanguageModelRegistry,
} from '@linnlabs/linnkit-provider-ai-sdk';
import { formalProviderRuntimeManifestRegistry } from '@linnya/provider-catalog/runtime-bindings';
import { assertFormalProviderRuntimeManifestCovered } from '../../../capabilities/ai-sdk/features/runtime-manifest-admission/functions/assertFormalProviderRuntimeManifestCovered';

/** Linnya 正式目录完整性属于 Host composition，不进入通用 Provider adapter package。 */
export function createLinnyaAiSdkLanguageModelRegistry(
  fetch?: AiSdkLanguageModelFactoryInput['fetch']
): AiSdkLanguageModelRegistry {
  const registry = createAiSdkLanguageModelRegistry(fetch);
  assertFormalProviderRuntimeManifestCovered({
    bindings: formalProviderRuntimeManifestRegistry.bindings,
    factories: registry.entries,
  });
  return registry;
}
