import type { DiscoveredModel } from '@app/schemas';
import type { ModelDiff } from 'src/domains/model-catalog';
import type {
  CustomApiProviderRefreshTarget,
  CustomApiProviderRefreshChanges,
} from '../definitions/customApiProviderRefreshTarget';
import { selectNewCustomApiModels } from './selectNewCustomApiModels';
import { buildCustomApiModelRegistration } from './buildCustomApiModelRegistration';
import { readCustomApiRuntimeBinding } from '../registry/customApiRuntimeBindingRegistry';

/** 只有完整发现快照能进入差异计算；存续模型不重建，保留用户配置与稳定身份。 */
export function selectCustomApiProviderRefreshChanges(
  target: CustomApiProviderRefreshTarget,
  discovered: readonly DiscoveredModel[]
): CustomApiProviderRefreshChanges {
  const existing = target.existingModels.map(model => {
    if (!model.inference_route) throw new Error('刷新目标缺少已校验的模型 route');
    return { localId: model.id, remoteId: model.inference_route.endpoint_model_id };
  });
  const remoteIds = new Set(discovered.map(model => model.id));
  return {
    target,
    addedModels: selectNewCustomApiModels(
      discovered,
      new Set(existing.map(model => model.remoteId))
    ),
    removedModelIds: existing
      .filter(model => !remoteIds.has(model.remoteId))
      .map(model => model.localId),
  };
}

export function buildCustomApiProviderRefreshDiff(
  providerName: string,
  changes: readonly CustomApiProviderRefreshChanges[],
  newModelIds: readonly string[]
): ModelDiff {
  let index = 0;
  return {
    added: changes.flatMap(({ target, addedModels }) =>
      addedModels.map(item => {
        const modelId = newModelIds[index++];
        if (modelId === undefined) throw new Error('刷新计划缺少新模型身份');
        return {
          ...buildCustomApiModelRegistration({
            modelId,
            endpointId: target.endpoint.endpoint_id,
            command: {
              api_format: target.apiFormat,
              base_url: target.endpoint.base_url,
              provider_name: providerName,
              models: [item],
            },
            model: item,
            binding: readCustomApiRuntimeBinding(target.apiFormat),
          }),
          inference_endpoint_id: target.endpoint.id,
        };
      })
    ),
    updated: [],
    removed: changes.flatMap(change => change.removedModelIds),
  };
}
