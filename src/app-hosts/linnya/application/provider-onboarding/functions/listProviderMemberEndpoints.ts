import type { InferenceEndpointView } from 'src/domains/model-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';

import type { ProviderOnboardingModelCatalogPort } from '../definitions/providerOnboardingPorts';

/**
 * Provider 成员（已准入的模型，以及停用条目）当前引用、且仍存在的 endpoint。
 * 停用条目的连接也算：Provider 只剩停用成员时，它们是这个 Provider 仅有的凭据边界。
 */
export function listProviderMemberEndpoints(
  provider: ConfiguredProvider,
  modelCatalog: Pick<
    ProviderOnboardingModelCatalogPort,
    'getModel' | 'getUnadmittedUserModels' | 'getInferenceEndpoints'
  >
): InferenceEndpointView[] {
  const memberIds = new Set(provider.models.map(association => association.model_config_id));
  const endpointIds = new Set<string>();
  for (const association of provider.models) {
    const endpointId = modelCatalog.getModel(association.model_config_id)?.inference_endpoint_id;
    if (endpointId) endpointIds.add(endpointId);
  }
  for (const entry of modelCatalog.getUnadmittedUserModels()) {
    if (entry.id && memberIds.has(entry.id) && entry.inference_endpoint_id) {
      endpointIds.add(entry.inference_endpoint_id);
    }
  }
  return modelCatalog.getInferenceEndpoints().filter(endpoint => endpointIds.has(endpoint.id));
}
