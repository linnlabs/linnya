import type {
  ModelPickerProviderModel,
  ModelPickerSnapshot,
  ModelPickerUnadmittedModel,
} from '@app/schemas/model-picker';

/** 只投影正式删除回执；空来源仍可管理和再次刷新，不能随最后一个模型一起从界面消失。 */
export function removeCommittedPickerModels(
  snapshot: ModelPickerSnapshot,
  removedModelIds: readonly string[]
): ModelPickerSnapshot {
  const removed = new Set(removedModelIds);
  const retained = (model: ModelPickerProviderModel): boolean =>
    !model.materialized || !removed.has(model.model_config_id);
  // 停用条目与已准入模型共用删除回执的 ID：删掉后在重读快照前也不能继续列在“配置无效”里。
  const retainedUnadmitted = (model: ModelPickerUnadmittedModel): boolean =>
    !removed.has(model.model_config_id);
  return {
    ...snapshot,
    ...(snapshot.cloud
      ? { cloud: { ...snapshot.cloud, models: snapshot.cloud.models.filter(retained) } }
      : {}),
    providers: snapshot.providers.map(provider => ({
      ...provider,
      models: provider.models.filter(retained),
      unadmitted_models: provider.unadmitted_models.filter(retainedUnadmitted),
    })),
    custom_models: snapshot.custom_models.filter(retained),
    ...(snapshot.custom_providers
      ? {
          custom_providers: snapshot.custom_providers.map(provider => ({
            ...provider,
            models: provider.models.filter(retained),
            unadmitted_models: provider.unadmitted_models.filter(retainedUnadmitted),
          })),
        }
      : {}),
    unassigned_unadmitted_models: snapshot.unassigned_unadmitted_models.filter(retainedUnadmitted),
  };
}

/** 显式删除来源与远端零模型是不同事实：只有来源删除回执才移除空分组本身。 */
export function removeCommittedPickerProvider(
  snapshot: ModelPickerSnapshot,
  providerName: string,
  removedModelIds: readonly string[]
): ModelPickerSnapshot {
  const next = removeCommittedPickerModels(snapshot, removedModelIds);
  return {
    ...next,
    ...(next.custom_providers
      ? { custom_providers: next.custom_providers.filter(group => group.provider_name !== providerName) }
      : {}),
  };
}
