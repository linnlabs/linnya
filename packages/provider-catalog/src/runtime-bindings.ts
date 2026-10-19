/** Host-only 子入口。Renderer 禁止导入。 */
export type { ProviderModelDiscoveryPolicy } from './definitions/providerModelDiscoveryPolicy';
export { getProviderModelDiscoveryPolicy } from './features/catalog-admission/functions/getProviderModelDiscoveryPolicy';
export type {
  FormalProviderModelRuntimeBinding,
  FormalProviderRuntimeBinding,
  FormalProviderRuntimeManifestRegistry,
  FormalProviderRuntimeManifestSnapshot,
} from './features/runtime-binding/definitions/formalProviderRuntimeManifest';
export { readFormalProviderRuntimeManifestSnapshot } from './features/runtime-binding/functions/readFormalProviderRuntimeManifestSnapshot';
export { formalProviderRuntimeManifestRegistry } from './features/runtime-binding/registry/formalProviderRuntimeManifestRegistry';
