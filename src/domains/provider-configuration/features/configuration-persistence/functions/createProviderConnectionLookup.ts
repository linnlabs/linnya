import type {
  ProviderConfigurationSnapshot,
  ProviderConnectionLookup,
} from '../../../definitions/providerConfiguration';
import { assertUniqueSnapshot } from '../../../shared/functions/assertUniqueSnapshot';

/** 只投影已提交的模型归属，pending intent 仍由启动恢复流程拥有。 */
export function createProviderConnectionLookup(
  snapshot: ProviderConfigurationSnapshot
): ProviderConnectionLookup {
  assertUniqueSnapshot(snapshot);
  const connectionIds = new Map<string, string>();
  for (const provider of snapshot.configured_providers) {
    for (const model of provider.models) {
      connectionIds.set(model.model_config_id, provider.provider_connection_definition_id);
    }
  }
  return modelConfigId => connectionIds.get(modelConfigId);
}
