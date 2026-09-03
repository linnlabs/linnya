import type {
  ModelPickerConfiguredProvider,
  ModelPickerMaterializedModel,
  ModelPickerProviderModel,
  ModelPickerSnapshot,
} from '@app/schemas/model-picker';
import type { ModelConfig } from 'src/domains/model-catalog';
import type {
  ConfiguredProvider,
  ConfiguredProviderModel,
} from 'src/domains/provider-configuration';
import { isModelRuntimeAvailable } from '../../model-runtime-availability';

import type { ComposeSelectableModelMenuInput } from '../definitions/modelPickerPorts';

function modelDisplayName(model: ModelConfig): string {
  return model.display_name.trim() || model.model_name;
}

function modelImageInput(model: ModelConfig): boolean {
  return (
    model.capabilities.includes('image_input') &&
    model.inference_route?.input_support.user_image === true
  );
}

function readModelPreference(
  model: ModelConfig,
  input: ComposeSelectableModelMenuInput,
  defaultVisible: boolean
): boolean {
  return (
    input.preferences.model_preferences.find(preference => preference.model_config_id === model.id)
      ?.visible ?? defaultVisible
  );
}

function projectMaterializedModel(
  model: ModelConfig,
  input: ComposeSelectableModelMenuInput,
  defaultVisible: boolean,
  providerModelId?: string
): ModelPickerMaterializedModel {
  return {
    materialized: true,
    model_config_id: model.id,
    ...(providerModelId ? { provider_model_id: providerModelId } : {}),
    display_name: modelDisplayName(model),
    picker_enabled: readModelPreference(model, input, defaultVisible),
    runtime_available: isModelRuntimeAvailable(model, {
      inferenceEndpoints: input.inference_endpoints,
      hasModelCredential: input.has_credential,
      hasProviderAccountCredential: input.has_provider_account_credential,
    }),
    capabilities: [...model.capabilities],
    image_input: modelImageInput(model),
    ...(model.reasoning?.supported_efforts.length
      ? {
          reasoning: {
            supported_efforts: [...model.reasoning.supported_efforts],
            ...(model.reasoning.default_effort
              ? { default_effort: model.reasoning.default_effort }
              : {}),
          },
        }
      : {}),
  };
}

function providerCredentialAvailable(
  provider: ConfiguredProvider,
  input: ComposeSelectableModelMenuInput
): boolean {
  const connectedAccount = input.provider_accounts.find(
    account =>
      account.provider_connection_definition_id === provider.provider_connection_definition_id
  );
  if (connectedAccount) {
    return input.has_provider_account_credential(connectedAccount.id);
  }
  const firstModelConfigId = provider.models[0]?.model_config_id;
  const firstEndpointId = input.models.find(
    model => model.id === firstModelConfigId
  )?.inference_endpoint_id;
  if (!firstEndpointId) return false;
  const endpoint = input.inference_endpoints.find(candidate => candidate.id === firstEndpointId);
  if (!endpoint) return false;
  if (endpoint.credential_reference.kind === 'provider_account') {
    return input.has_provider_account_credential(endpoint.credential_reference.account_id);
  }
  return endpoint.credential_status !== 'missing';
}

function providerVisible(
  provider: ConfiguredProvider,
  input: ComposeSelectableModelMenuInput
): boolean {
  return (
    input.preferences.provider_preferences.find(
      preference => preference.configured_provider_id === provider.id
    )?.visible ?? true
  );
}

function projectAssociatedProviderModel(
  association: ConfiguredProviderModel,
  input: ComposeSelectableModelMenuInput
): ModelPickerMaterializedModel | undefined {
  const model = input.models.find(candidate => candidate.id === association.model_config_id);
  if (!model) return undefined;
  return projectMaterializedModel(model, input, true, association.provider_model_id);
}

function projectConfiguredProvider(
  provider: ConfiguredProvider,
  input: ComposeSelectableModelMenuInput
): ModelPickerConfiguredProvider | undefined {
  const definition = input.provider_definitions.find(
    candidate => candidate.id === provider.provider_definition_id
  );
  const connection = definition?.connections.find(
    candidate => candidate.id === provider.provider_connection_definition_id
  );
  if (!definition || !connection || connection.kind === 'cloud') return undefined;
  const associationsByProviderModelId = new Map(
    provider.models.map(association => [association.provider_model_id, association])
  );
  const catalogModels: ModelPickerProviderModel[] = connection.models.map(modelDefinition => {
    const association = associationsByProviderModelId.get(modelDefinition.id);
    if (!association) {
      return {
        materialized: false,
        provider_model_id: modelDefinition.id,
        display_name: modelDefinition.display_name,
        picker_enabled: false,
        runtime_available: false,
        capabilities: ['chat'],
        image_input: modelDefinition.capabilities.image_input,
      };
    }
    return (
      projectAssociatedProviderModel(association, input) ?? {
        materialized: false,
        provider_model_id: modelDefinition.id,
        display_name: modelDefinition.display_name,
        picker_enabled: false,
        runtime_available: false,
        capabilities: ['chat'],
        image_input: modelDefinition.capabilities.image_input,
      }
    );
  });
  const knownProviderModelIds = new Set(connection.models.map(model => model.id));
  const removedCatalogModels = provider.models
    .filter(association => !knownProviderModelIds.has(association.provider_model_id))
    .flatMap(association => projectAssociatedProviderModel(association, input) ?? []);
  const accountIds = new Set(
    input.provider_accounts
      .filter(account => account.provider_connection_definition_id === connection.id)
      .map(account => account.id)
  );
  const associatedModelConfigIds = new Set(
    provider.models.map(association => association.model_config_id)
  );
  const accountModels = input.models
    .filter(
      model =>
        model.catalog_source === 'account' &&
        model.credential_reference?.kind === 'provider_account' &&
        accountIds.has(model.credential_reference.account_id) &&
        !associatedModelConfigIds.has(model.id)
    )
    .map(model => projectMaterializedModel(model, input, true));

  return {
    configured_provider_id: provider.id,
    provider_definition_id: provider.provider_definition_id,
    provider_connection_definition_id: provider.provider_connection_definition_id,
    display_name: definition.display_name,
    connection_display_name: connection.display_name,
    kind: connection.kind,
    picker_enabled: providerVisible(provider, input),
    credential_available: providerCredentialAvailable(provider, input),
    models: [...catalogModels, ...removedCatalogModels, ...accountModels],
  };
}

/**
 * 跨 catalog 的唯一组合点。这里投影产品状态，但不修改任何 catalog 或偏好。
 */
export function composeSelectableModelMenu(
  input: ComposeSelectableModelMenuInput
): ModelPickerSnapshot {
  const configuredModelIds = new Set(
    input.configured_providers.flatMap(provider =>
      provider.models.map(model => model.model_config_id)
    )
  );
  const cloudModels = input.models
    .filter(model => model.catalog_source === 'cloud')
    .map(model => projectMaterializedModel(model, input, model.ui_visibility.includes('chat')));
  const customModels = input.models
    .filter(model => model.catalog_source === 'user' && !configuredModelIds.has(model.id))
    .map(model => projectMaterializedModel(model, input, true));

  return {
    ...(cloudModels.length > 0
      ? { cloud: { display_name: 'Linnya Cloud', models: cloudModels } }
      : {}),
    providers: input.configured_providers.flatMap(
      provider => projectConfiguredProvider(provider, input) ?? []
    ),
    custom_models: customModels,
  };
}
