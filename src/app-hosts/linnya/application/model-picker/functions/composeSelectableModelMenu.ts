import type {
  ModelPickerConfiguredProvider,
  ModelPickerMaterializedModel,
  ModelPickerProviderModel,
  ModelPickerSnapshot,
} from '@app/schemas/model-picker';
import { readCustomApiFormatForRouteProfileId } from '@app/schemas/custom-api-onboarding';
import type { ProviderConnectionDefinition } from '@linnya/provider-catalog';
import type { ModelConfig } from 'src/domains/model-catalog';
import type {
  ConfiguredProvider,
  ConfiguredProviderModel,
} from 'src/domains/provider-configuration';
import { readCustomApiProviderName } from '../../custom-api-onboarding';
import { isModelRuntimeAvailable } from '../../model-runtime-availability';
import { resolveProviderOnboardingAuthMethod } from '../../provider-onboarding';

import type { ComposeSelectableModelMenuInput } from '../definitions/modelPickerPorts';
import type { ProviderDiscoveredModel } from 'src/app-hosts/linnya/adapters/provider-model-discovery';

type CredentialUnavailableReason = NonNullable<
  ModelPickerConfiguredProvider['credential_unavailable_reason']
>;

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

function providerCredentialStatus(
  provider: ConfiguredProvider,
  input: ComposeSelectableModelMenuInput
): { readonly available: boolean; readonly reason?: CredentialUnavailableReason } {
  const connectedAccount = input.provider_accounts.find(
    account =>
      account.provider_connection_definition_id === provider.provider_connection_definition_id
  );
  if (connectedAccount) {
    const status = input.get_provider_account_credential_status(connectedAccount.id);
    return status === 'available' && input.has_provider_account_credential(connectedAccount.id)
      ? { available: true }
      : { available: false, reason: status === 'available' ? 'missing' : status };
  }
  const firstModelConfigId = provider.models[0]?.model_config_id;
  if (!firstModelConfigId) return { available: false, reason: 'missing' };
  const firstEndpointId = input.models.find(
    model => model.id === firstModelConfigId
  )?.inference_endpoint_id;
  if (!firstEndpointId) return { available: false, reason: 'missing' };
  const endpoint = input.inference_endpoints.find(candidate => candidate.id === firstEndpointId);
  if (!endpoint) return { available: false, reason: 'missing' };
  if (endpoint.credential_reference.kind === 'provider_account') {
    const status = input.get_provider_account_credential_status(
      endpoint.credential_reference.account_id
    );
    return status === 'available' &&
      input.has_provider_account_credential(endpoint.credential_reference.account_id)
      ? { available: true }
      : { available: false, reason: status === 'available' ? 'missing' : status };
  }
  const status = input.get_credential_status(firstModelConfigId);
  const resolvedStatus =
    endpoint.credential_status === 'missing' ? 'missing' : status;
  return resolvedStatus === 'available'
    ? { available: true }
    : { available: false, reason: resolvedStatus };
}

/** connection setup schema 是凭据形态的唯一真相；本地运行时不持有凭据。 */
function providerCredentialKind(
  connection: ProviderConnectionDefinition
): ModelPickerConfiguredProvider['credential_kind'] {
  if (connection.kind === 'local_runtime') return 'none';
  return resolveProviderOnboardingAuthMethod(connection) ?? 'none';
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
  const candidates: readonly ProviderDiscoveredModel[] =
    input.discovered_models.read(connection.id) ??
    connection.models.map(definition => ({ status: 'available', definition }));
  const catalogModels: ModelPickerProviderModel[] = candidates.map(candidate => {
    const modelId = candidate.status === 'available' ? candidate.definition.id : candidate.id;
    const existing = associationsByProviderModelId.get(modelId);
    const materialized = existing ? projectAssociatedProviderModel(existing, input) : undefined;
    if (materialized) return materialized;
    if (candidate.status === 'unavailable') {
      return {
        materialized: false,
        provider_model_id: candidate.id,
        display_name: candidate.display_name,
        activation_unavailable_reason: candidate.reason,
        picker_enabled: false,
        runtime_available: false,
        capabilities: ['chat'],
        image_input: false,
      };
    }
    const modelDefinition = candidate.definition;
    return {
      materialized: false,
      provider_model_id: modelDefinition.id,
      display_name: modelDefinition.display_name,
      picker_enabled: false,
      runtime_available: false,
      capabilities: ['chat'],
      image_input: modelDefinition.capabilities.image_input,
    };
  });
  const knownProviderModelIds = new Set(
    candidates.map(candidate =>
      candidate.status === 'available' ? candidate.definition.id : candidate.id
    )
  );
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

  const credential = providerCredentialStatus(provider, input);
  return {
    configured_provider_id: provider.id,
    provider_definition_id: provider.provider_definition_id,
    provider_connection_definition_id: provider.provider_connection_definition_id,
    display_name: definition.display_name,
    connection_display_name: connection.display_name,
    can_refresh_models: input.can_refresh_models(connection.id),
    kind: connection.kind,
    credential_kind: providerCredentialKind(connection),
    picker_enabled: providerVisible(provider, input),
    credential_available: credential.available,
    ...(credential.reason ? { credential_unavailable_reason: credential.reason } : {}),
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
  // 分组拥有连接的生命周期；远端模型为空时仍保留设置中的刷新、编辑和删除入口。
  const customProviders = input.custom_api_groups.map(group => {
    const endpoint = input.inference_endpoints.find(
      candidate => candidate.id === group.inference_endpoint_ids[0]
    );
    const models = input.models.filter(model =>
      model.catalog_source === 'user' &&
      !configuredModelIds.has(model.id) &&
      readCustomApiProviderName(model) === group.name &&
      model.inference_endpoint_id !== undefined &&
      group.inference_endpoint_ids.includes(model.inference_endpoint_id)
    );
    return {
      provider_id: `custom:${group.name}`,
      provider_name: group.name,
      api_format: endpoint ? readCustomApiFormatForRouteProfileId(endpoint.route_profile_id) : undefined,
      base_url: endpoint?.base_url,
      endpoint_id: endpoint?.id,
      models: models.map(model => projectMaterializedModel(model, input, true)),
    };
  });
  const customModels = customProviders.flatMap(group => group.models);

  return {
    ...(cloudModels.length > 0
      ? { cloud: { display_name: 'Linnya Cloud', models: cloudModels } }
      : {}),
    providers: input.configured_providers.flatMap(
      provider => projectConfiguredProvider(provider, input) ?? []
    ),
    custom_models: customModels,
    custom_providers: customProviders,
  };
}
