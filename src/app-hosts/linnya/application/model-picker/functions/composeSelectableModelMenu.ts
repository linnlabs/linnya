import type {
  ModelPickerConfiguredProvider,
  ModelPickerMaterializedModel,
  ModelPickerProviderModel,
  ModelPickerSnapshot,
  ModelPickerUnadmittedModel,
} from '@app/schemas/model-picker';
import {
  readCustomApiFormatForRouteProfileId,
  readCustomCapabilityFormatForProfile,
} from '@app/schemas/custom-api-onboarding';
import type { ProviderConnectionDefinition } from '@linnya/provider-catalog';
import type {
  InferenceEndpointView,
  ModelConfig,
  UnadmittedUserModel,
} from 'src/domains/model-catalog';
import {
  findFirstCatalogedProviderMember,
  type ConfiguredProvider,
  type ConfiguredProviderModel,
} from 'src/domains/provider-configuration';
import { readCustomApiProviderName } from '../../custom-api-onboarding';
import { isModelRuntimeAvailable } from '../../model-runtime-availability';
import {
  canRepairUnadmittedProviderModels,
  resolveProviderOnboardingAuthMethod,
} from '../../provider-onboarding';

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

/** 停用条目只能删除或修复；原文留给悬停详情，显示名缺失时退回调用方给的名称。 */
function projectUnadmittedModel(
  entry: UnadmittedUserModel & { readonly id: string },
  fallbackDisplayName: string,
  repairable: boolean
): ModelPickerUnadmittedModel {
  return {
    model_config_id: entry.id,
    display_name: entry.display_name ?? fallbackDisplayName,
    reason_kind: entry.reason_kind,
    reason: entry.reason,
    repairable,
  };
}

/** 没有 ID 的停用条目无法被任何归属、偏好或删除入口引用，不进入设置页投影。 */
function addressableUnadmittedModels(
  input: ComposeSelectableModelMenuInput
): Array<UnadmittedUserModel & { readonly id: string }> {
  return input.unadmitted_models.flatMap(entry =>
    entry.id === undefined ? [] : [{ ...entry, id: entry.id }]
  );
}

type CredentialStatus = {
  readonly available: boolean;
  readonly reason?: CredentialUnavailableReason;
};

function endpointCredentialStatus(
  endpoint: InferenceEndpointView,
  input: ComposeSelectableModelMenuInput,
  modelCredentialStatus: ReturnType<ComposeSelectableModelMenuInput['get_credential_status']>
): CredentialStatus {
  if (endpoint.credential_reference.kind === 'provider_account') {
    const status = input.get_provider_account_credential_status(
      endpoint.credential_reference.account_id
    );
    return status === 'available' &&
      input.has_provider_account_credential(endpoint.credential_reference.account_id)
      ? { available: true }
      : { available: false, reason: status === 'available' ? 'missing' : status };
  }
  const resolvedStatus =
    endpoint.credential_status === 'missing' ? 'missing' : modelCredentialStatus;
  return resolvedStatus === 'available'
    ? { available: true }
    : { available: false, reason: resolvedStatus };
}

function providerCredentialStatus(
  provider: ConfiguredProvider,
  input: ComposeSelectableModelMenuInput
): CredentialStatus {
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
  const credentialModel = findFirstCatalogedProviderMember(provider, modelConfigId =>
    input.models.find(model => model.id === modelConfigId)
  )?.model;
  if (credentialModel) {
    const endpointId = credentialModel.inference_endpoint_id;
    const endpoint = endpointId
      ? input.inference_endpoints.find(candidate => candidate.id === endpointId)
      : undefined;
    if (!endpoint) return { available: false, reason: 'missing' };
    return endpointCredentialStatus(
      endpoint,
      input,
      input.get_credential_status(credentialModel.id)
    );
  }
  // 只剩停用成员：凭据仍在它们引用的连接上（同一 connection 共用一条凭据边界），
  // 不能因为运行目录里没有成员就报“未找到本机凭据”。
  const memberIds = new Set(provider.models.map(association => association.model_config_id));
  const unadmittedEndpoint = input.unadmitted_models
    .filter(entry => entry.id !== undefined && memberIds.has(entry.id))
    .flatMap(
      entry =>
        input.inference_endpoints.find(candidate => candidate.id === entry.inference_endpoint_id) ??
        []
    )[0];
  if (!unadmittedEndpoint) return { available: false, reason: 'missing' };
  return endpointCredentialStatus(unadmittedEndpoint, input, 'available');
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
  if (!definition || !connection) return undefined;
  const associationsByProviderModelId = new Map(
    provider.models.map(association => [association.provider_model_id, association])
  );
  const unadmittedById = new Map(
    addressableUnadmittedModels(input).map(entry => [entry.id, entry])
  );
  const candidates: readonly ProviderDiscoveredModel[] =
    input.discovered_models.read(connection.id) ??
    connection.models.map(definition => ({ status: 'available', definition }));
  const catalogModels = candidates.flatMap((candidate): ModelPickerProviderModel[] => {
    const modelId = candidate.status === 'available' ? candidate.definition.id : candidate.id;
    const existing = associationsByProviderModelId.get(modelId);
    const materialized = existing ? projectAssociatedProviderModel(existing, input) : undefined;
    if (materialized) return [materialized];
    // 停用成员已经有归属：当成“未启用”候选会让开关去重复注册（409），它只在“配置无效”里出现。
    if (existing && unadmittedById.has(existing.model_config_id)) return [];
    if (candidate.status === 'unavailable') {
      return [
        {
          materialized: false,
          provider_model_id: candidate.id,
          display_name: candidate.display_name,
          activation_unavailable_reason: candidate.reason,
          picker_enabled: false,
          runtime_available: false,
          capabilities: ['chat'],
          image_input: false,
        },
      ];
    }
    const modelDefinition = candidate.definition;
    return [
      {
        materialized: false,
        provider_model_id: modelDefinition.id,
        display_name: modelDefinition.display_name,
        picker_enabled: false,
        runtime_available: false,
        capabilities: ['chat'],
        image_input: modelDefinition.capabilities.image_input,
      },
    ];
  });
  // 能否修复与修复用例同一规则：connection 支持按定义重建，且当前定义里仍有这个模型。
  const repairableConnection = canRepairUnadmittedProviderModels(connection);
  const availableDefinitions = new Map(
    candidates.flatMap(candidate =>
      candidate.status === 'available' ? [[candidate.definition.id, candidate.definition]] : []
    )
  );
  const unadmittedModels = provider.models.flatMap(association => {
    const entry = unadmittedById.get(association.model_config_id);
    if (!entry) return [];
    const definition = availableDefinitions.get(association.provider_model_id);
    return [
      projectUnadmittedModel(
        entry,
        definition?.display_name ?? association.provider_model_id,
        repairableConnection && definition !== undefined
      ),
    ];
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
    unadmitted_models: unadmittedModels,
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
  // 正式 Provider 成员归 Provider；其余按 Catalog 给出的分组归属，都不属于的是“未归类”（多为旧版删分组遗留）。
  const unadmittedModels = addressableUnadmittedModels(input).filter(
    entry => !configuredModelIds.has(entry.id)
  );
  const unassignedUnadmittedModels = unadmittedModels
    .filter(entry => entry.custom_api_group_name === undefined)
    .map(entry => projectUnadmittedModel(entry, entry.id, false));
  // 分组拥有连接的生命周期；远端模型为空时仍保留设置中的刷新、编辑和删除入口。
  const customProviders = input.custom_api_groups.map(group => {
    const endpoint = input.inference_endpoints.find(
      candidate => candidate.id === group.inference_endpoint_ids[0]
    );
    const models = input.models.filter(
      model =>
        model.catalog_source === 'user' &&
        !configuredModelIds.has(model.id) &&
        readCustomApiProviderName(model) === group.name &&
        model.inference_endpoint_id !== undefined &&
        group.inference_endpoint_ids.includes(model.inference_endpoint_id)
    );
    return {
      provider_id: `custom:${group.name}`,
      provider_name: group.name,
      api_format: endpoint
        ? readCustomApiFormatForRouteProfileId(endpoint.route_profile_id)
        : undefined,
      capability_api_format: endpoint
        ? readCustomCapabilityFormatForProfile(endpoint.route_profile_id)
        : undefined,
      base_url: endpoint?.base_url,
      endpoint_id: endpoint?.id,
      models: models.map(model => projectMaterializedModel(model, input, true)),
      // 用户 2026-11-26 定：自定义分组的同步不重建无效条目（会丢掉用户改过的显示名与容量），只给删除。
      unadmitted_models: unadmittedModels
        .filter(entry => entry.custom_api_group_name === group.name)
        .map(entry => projectUnadmittedModel(entry, entry.id, false)),
    };
  });
  const customModels = customProviders.flatMap(group => group.models);

  return {
    providers: input.configured_providers.flatMap(
      provider => projectConfiguredProvider(provider, input) ?? []
    ),
    custom_models: customModels,
    custom_providers: customProviders,
    unassigned_unadmitted_models: unassignedUnadmittedModels,
  };
}
