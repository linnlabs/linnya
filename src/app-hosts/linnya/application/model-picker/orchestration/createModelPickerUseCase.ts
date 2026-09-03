import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

import { ModelPickerError } from '../definitions/modelPickerError';
import type {
  ModelPickerModelCatalogPort,
  ModelPickerPreferencesPort,
  ModelPickerProviderAccountPort,
  ModelPickerProviderModelActivationPort,
  ModelPickerProviderCatalogPort,
  ModelPickerProviderConfigurationPort,
  ModelPickerUseCase,
} from '../definitions/modelPickerPorts';
import { composeSelectableModelMenu } from '../functions/composeSelectableModelMenu';

export interface CreateModelPickerUseCaseDependencies {
  readonly providerCatalog: ModelPickerProviderCatalogPort;
  readonly providerConfigurations: ModelPickerProviderConfigurationPort;
  readonly modelCatalog: ModelPickerModelCatalogPort;
  readonly preferences: ModelPickerPreferencesPort;
  readonly providerAccounts: ModelPickerProviderAccountPort;
  readonly providerModelActivation: ModelPickerProviderModelActivationPort;
}

export function createModelPickerUseCase(
  dependencies: CreateModelPickerUseCaseDependencies
): ModelPickerUseCase {
  function read(): ModelPickerSnapshot {
    return composeSelectableModelMenu({
      provider_definitions: dependencies.providerCatalog.list(),
      configured_providers: dependencies.providerConfigurations.list(),
      models: dependencies.modelCatalog.getModels(),
      inference_endpoints: dependencies.modelCatalog.getInferenceEndpoints(),
      provider_accounts: dependencies.providerAccounts.list(),
      preferences: dependencies.preferences.read(),
      has_credential: modelConfigId => dependencies.modelCatalog.hasCredential(modelConfigId),
      has_provider_account_credential: accountId =>
        dependencies.providerAccounts.hasCredential(accountId),
    });
  }

  return Object.freeze({
    read,
    async setProviderVisibility(
      configuredProviderId: string,
      visible: boolean
    ): Promise<ModelPickerSnapshot> {
      if (
        !dependencies.providerConfigurations
          .list()
          .some(provider => provider.id === configuredProviderId)
      ) {
        throw new ModelPickerError(
          'model_picker.configured_provider_not_found',
          '已配置 Provider 不存在',
          404
        );
      }
      await dependencies.preferences.setProviderVisibility(configuredProviderId, visible);
      return read();
    },
    async setModelVisibility(
      modelConfigId: string,
      visible: boolean
    ): Promise<ModelPickerSnapshot> {
      const model = dependencies.modelCatalog.getModel(modelConfigId);
      if (!model) {
        throw new ModelPickerError('model_picker.model_not_found', '模型不存在', 404);
      }
      const isManagedModel =
        model.catalog_source === 'cloud' ||
        model.catalog_source === 'account' ||
        model.catalog_source === 'user';
      if (!isManagedModel) {
        throw new ModelPickerError('model_picker.model_not_managed', '该模型不属于模型管理', 400);
      }
      await dependencies.preferences.setModelVisibility(modelConfigId, visible);
      return read();
    },
    async activateProviderModel(
      configuredProviderId: string,
      providerModelId: string
    ): Promise<ModelPickerSnapshot> {
      const configuredProvider = dependencies.providerConfigurations
        .list()
        .find(provider => provider.id === configuredProviderId);
      if (!configuredProvider) {
        throw new ModelPickerError(
          'model_picker.configured_provider_not_found',
          '已配置 Provider 不存在',
          404
        );
      }
      const catalogEntry = dependencies.providerCatalog.getConnection(
        configuredProvider.provider_connection_definition_id
      );
      if (!catalogEntry?.connection.models.some(model => model.id === providerModelId)) {
        throw new ModelPickerError(
          'model_picker.provider_model_not_found',
          'Provider 目录模型不存在',
          404
        );
      }
      await dependencies.providerModelActivation.registerDirectProviderModel({
        provider_connection_definition_id: configuredProvider.provider_connection_definition_id,
        provider_model_id: providerModelId,
      });
      return read();
    },
  });
}
