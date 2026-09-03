import type {
  ConfiguredModelRemovalCatalogPort,
  ConfiguredModelRemovalConfigurationPort,
  ConfiguredModelRemovalIdFactory,
  ConfiguredModelRemovalPreferencesPort,
  ConfiguredModelRemovalUseCase,
} from '../definitions/configuredModelRemovalPorts';

export interface CreateConfiguredModelRemovalUseCaseDependencies {
  readonly modelCatalog: ConfiguredModelRemovalCatalogPort;
  readonly providerConfigurations: ConfiguredModelRemovalConfigurationPort;
  readonly modelPickerPreferences: ConfiguredModelRemovalPreferencesPort;
  readonly idFactory: ConfiguredModelRemovalIdFactory;
}

/** 协调 Model Catalog 与正式 Provider 归属删除；Custom API 会得到 null intent 并直接删除。 */
export function createConfiguredModelRemovalUseCase(
  dependencies: CreateConfiguredModelRemovalUseCaseDependencies
): ConfiguredModelRemovalUseCase {
  return Object.freeze({
    async remove(modelId: string) {
      const intent = await dependencies.providerConfigurations.beginModelRemoval({
        intent_id: dependencies.idFactory.create(),
        model_config_id: modelId,
      });
      try {
        await dependencies.modelCatalog.removeModel(modelId);
      } catch (error: unknown) {
        if (intent) await dependencies.providerConfigurations.cancelModelRemoval(intent.id);
        throw error;
      }
      let modelPickerPreferenceRecoveryPending = false;
      try {
        await dependencies.modelPickerPreferences.removeModelPreference(modelId);
      } catch {
        // Catalog 已经删除；启动 reconcile 会按现存模型身份清掉孤儿偏好。
        modelPickerPreferenceRecoveryPending = true;
      }

      let providerAssociationRecoveryPending = false;
      if (intent) {
        try {
          await dependencies.providerConfigurations.completeModelRemoval(intent.id);
        } catch {
          // 模型删除已经提交，不能向用户谎报“删除失败”；durable intent 会在下次启动收口归属。
          providerAssociationRecoveryPending = true;
        }
      }

      return {
        provider_association_recovery_pending: providerAssociationRecoveryPending,
        model_picker_preference_recovery_pending: modelPickerPreferenceRecoveryPending,
      };
    },
  });
}
