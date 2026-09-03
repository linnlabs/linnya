import { parseProviderCatalogSnapshot } from '../catalog-admission/parseProviderCatalogSnapshot';
import { readFormalProviderRuntimeManifestSnapshot } from '../runtime-binding/functions/readFormalProviderRuntimeManifestSnapshot';

/**
 * 两个生成资产必须作为同一次目录事务被接纳。
 * 这里校验跨投影不变量，单个资产内部的严格结构由各自 parser 负责。
 */
export function assertProviderCatalogProjectionConsistency(
  publicCatalogInput: unknown,
  runtimeBindingInput: unknown
): void {
  const publicCatalog = parseProviderCatalogSnapshot(publicCatalogInput);
  const runtimeManifest = readFormalProviderRuntimeManifestSnapshot(runtimeBindingInput);

  if (runtimeManifest.generation_id !== publicCatalog.generation.id) {
    throw new Error(
      `Provider Catalog 双投影 generation 不一致: public=${publicCatalog.generation.id}, runtime=${runtimeManifest.generation_id}`
    );
  }
  if (runtimeManifest.source_sha256 !== publicCatalog.generation.source_sha256) {
    throw new Error('Provider Catalog 双投影 source digest 不一致');
  }

  const publicProviders = new Map(
    publicCatalog.providers.map(provider => [provider.id, provider] as const)
  );
  for (const binding of runtimeManifest.bindings) {
    const provider = publicProviders.get(binding.provider_definition_id);
    if (!provider) {
      throw new Error(`Provider runtime binding 未进入公开目录: ${binding.provider_definition_id}`);
    }

    const connection = provider.connections.find(
      candidate => candidate.id === binding.provider_connection_definition_id
    );
    if (!connection) {
      throw new Error(
        `Provider runtime binding connection 未进入公开目录: ${binding.provider_connection_definition_id}`
      );
    }
    const publicModelIds = new Set(connection.models.map(model => model.id));
    for (const modelBinding of binding.model_route_bindings ?? []) {
      if (!publicModelIds.has(modelBinding.model_id)) {
        throw new Error(
          `Connection ${binding.provider_connection_definition_id} 的 runtime 模型未进入公开目录: ${modelBinding.model_id}`
        );
      }
    }
  }
}
