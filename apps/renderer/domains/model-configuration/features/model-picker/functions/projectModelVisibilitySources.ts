import type {
  ModelPickerConfiguredProvider,
  ModelPickerCredentialUnavailableReason,
  ModelPickerCustomProviderGroup,
  ModelPickerMaterializedModel,
  ModelPickerProviderModel,
  ModelPickerSnapshot,
  ModelPickerUnadmittedModel,
} from '@app/schemas/model-picker';

/** 选择 Host 投影里的“未归类”来源时使用的固定 ID；它不是正式 Provider 或自定义分组。 */
export const UNASSIGNED_MODEL_SOURCE_ID = 'unassigned' as const;

export type ModelVisibilitySource =
  | {
      readonly id: string;
      readonly kind: 'provider';
      readonly displayName: string;
      readonly configuredProviderId: string;
      readonly providerConnectionDefinitionId: string;
      readonly credentialKind: ModelPickerConfiguredProvider['credential_kind'];
      readonly canRefreshModels: boolean;
      readonly pickerEnabled: boolean;
      readonly credentialAvailable: boolean;
      readonly credentialUnavailableReason?: ModelPickerCredentialUnavailableReason;
      readonly models: readonly ModelPickerProviderModel[];
      /** 启动时停用的成员；只能删除，或按 Provider 定义刷新修复。 */
      readonly unadmittedModels: readonly ModelPickerUnadmittedModel[];
    }
  | {
      readonly id: string;
      readonly kind: 'custom_provider';
      readonly displayName: string;
      readonly providerName: string;
      readonly apiFormat?: ModelPickerCustomProviderGroup['api_format'];
      readonly capabilityApiFormat?: ModelPickerCustomProviderGroup['capability_api_format'];
      readonly baseUrl?: string;
      readonly endpointId?: string;
      readonly models: readonly ModelPickerMaterializedModel[];
      readonly unadmittedModels: readonly ModelPickerUnadmittedModel[];
    }
  | {
      readonly id: 'custom';
      readonly kind: 'custom';
      readonly displayName: string;
      readonly models: readonly ModelPickerMaterializedModel[];
      readonly unadmittedModels: readonly ModelPickerUnadmittedModel[];
    }
  | {
      /** 归属已不存在的停用条目（多为旧版删分组遗留），只给删除；只在存在这类条目时出现。 */
      readonly id: typeof UNASSIGNED_MODEL_SOURCE_ID;
      readonly kind: 'unassigned';
      readonly displayName: string;
      readonly models: readonly ModelPickerMaterializedModel[];
      readonly unadmittedModels: readonly ModelPickerUnadmittedModel[];
    };

export function projectModelVisibilitySources(
  snapshot: ModelPickerSnapshot,
  labels: { readonly customModels: string; readonly unassigned: string }
): readonly ModelVisibilitySource[] {
  const connectionCountByProviderId = new Map<string, number>();
  for (const provider of snapshot.providers) {
    connectionCountByProviderId.set(
      provider.provider_definition_id,
      (connectionCountByProviderId.get(provider.provider_definition_id) ?? 0) + 1
    );
  }

  const customProviders = (snapshot.custom_providers ?? []).map(group => ({
    id: group.provider_id,
    kind: 'custom_provider' as const,
    displayName: group.provider_name,
    providerName: group.provider_name,
    apiFormat: group.api_format,
    capabilityApiFormat: group.capability_api_format,
    baseUrl: group.base_url,
    endpointId: group.endpoint_id,
    models: group.models,
    unadmittedModels: group.unadmitted_models,
  }));

  // 如果没有按 custom_providers 组织，回退到以前单一的 custom_models
  const hasCustomProviders = customProviders.length > 0;

  return [
    ...snapshot.providers.map(provider => ({
      id: `provider:${provider.configured_provider_id}`,
      kind: 'provider' as const,
      displayName:
        connectionCountByProviderId.get(provider.provider_definition_id) === 1
          ? provider.display_name
          : `${provider.display_name} · ${provider.connection_display_name}`,
      configuredProviderId: provider.configured_provider_id,
      providerConnectionDefinitionId: provider.provider_connection_definition_id,
      credentialKind: provider.credential_kind,
      canRefreshModels: provider.can_refresh_models,
      pickerEnabled: provider.picker_enabled,
      credentialAvailable: provider.credential_available,
      ...(provider.credential_unavailable_reason
        ? { credentialUnavailableReason: provider.credential_unavailable_reason }
        : {}),
      models: provider.models,
      unadmittedModels: provider.unadmitted_models,
    })),
    ...customProviders,
    ...(!hasCustomProviders && snapshot.custom_models.length > 0
      ? [
          {
            id: 'custom' as const,
            kind: 'custom' as const,
            displayName: labels.customModels,
            models: snapshot.custom_models,
            unadmittedModels: [],
          },
        ]
      : []),
    ...(snapshot.unassigned_unadmitted_models.length > 0
      ? [
          {
            id: UNASSIGNED_MODEL_SOURCE_ID,
            kind: 'unassigned' as const,
            displayName: labels.unassigned,
            models: [],
            unadmittedModels: snapshot.unassigned_unadmitted_models,
          },
        ]
      : []),
  ];
}

export function filterModelVisibilitySources(
  sources: readonly ModelVisibilitySource[],
  query: string
): readonly ModelVisibilitySource[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return sources;
  return sources.filter(source => source.displayName.toLocaleLowerCase().includes(normalized));
}

/** 停用条目按显示名搜索，与模型列表共用同一个搜索框。 */
export function filterUnadmittedModels(
  source: ModelVisibilitySource,
  query: string
): readonly ModelPickerUnadmittedModel[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return source.unadmittedModels;
  return source.unadmittedModels.filter(model =>
    model.display_name.toLocaleLowerCase().includes(normalized)
  );
}

export function filterModelVisibilityModels(
  source: ModelVisibilitySource,
  query: string
): readonly ModelPickerProviderModel[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return source.models;
  return source.models.filter(model => {
    const providerModelId = model.provider_model_id ?? '';
    return (
      model.display_name.toLocaleLowerCase().includes(normalized) ||
      providerModelId.toLocaleLowerCase().includes(normalized)
    );
  });
}
