import type { ProviderModelDefinition } from '@linnya/provider-catalog';
import type { ProviderDiscoveredModel } from '../definitions/providerModelDiscovery';
import type { ModelListingIdentity } from 'src/domains/model-catalog';

/** 供应商只确认成员；容量、能力和多协议准入仍需精确 ID 的可信资料。 */
export function completeListedProviderModels(
  models: readonly ModelListingIdentity[],
  metadata: readonly ProviderModelDefinition[],
  bundledModels: readonly ProviderModelDefinition[],
  requiresBundledModel: boolean
): readonly ProviderDiscoveredModel[] {
  const definitions = new Map(metadata.map(model => [model.id, model]));
  const reviewedIds = new Set(bundledModels.map(model => model.id));
  return models.map(model => {
    const definition = definitions.get(model.id);
    const unavailable = (reason: string): ProviderDiscoveredModel => ({
      status: 'unavailable',
      id: model.id,
      display_name: model.display_name ?? definition?.display_name ?? model.id,
      reason,
    });
    if (requiresBundledModel && !reviewedIds.has(model.id)) {
      return unavailable('该模型的调用协议尚未审核，请等待目录更新后启用');
    }
    if (!definition) return unavailable('尚无经过准入的模型容量与能力资料');
    if (!definition.capabilities.tool_call) {
      return unavailable('该模型尚未确认支持 Agent 所需的工具调用');
    }
    return { status: 'available', definition };
  });
}
