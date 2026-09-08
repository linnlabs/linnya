import type {
  ModelPickerCredentialUnavailableReason,
  ModelPickerMaterializedModel,
  ModelPickerProviderModel,
  ModelPickerSnapshot,
} from '@app/schemas/model-picker';

export type ModelVisibilitySource =
  | {
      readonly id: 'cloud' | 'custom';
      readonly kind: 'cloud' | 'custom';
      readonly displayName: string;
      readonly models: readonly ModelPickerMaterializedModel[];
    }
  | {
      readonly id: string;
      readonly kind: 'provider';
      readonly displayName: string;
      readonly configuredProviderId: string;
      readonly pickerEnabled: boolean;
      readonly credentialAvailable: boolean;
      readonly credentialUnavailableReason?: ModelPickerCredentialUnavailableReason;
      readonly models: readonly ModelPickerProviderModel[];
    };

export function projectModelVisibilitySources(
  snapshot: ModelPickerSnapshot,
  customModelsLabel: string
): readonly ModelVisibilitySource[] {
  const connectionCountByProviderId = new Map<string, number>();
  for (const provider of snapshot.providers) {
    connectionCountByProviderId.set(
      provider.provider_definition_id,
      (connectionCountByProviderId.get(provider.provider_definition_id) ?? 0) + 1
    );
  }
  return [
    ...(snapshot.cloud
      ? [
          {
            id: 'cloud' as const,
            kind: 'cloud' as const,
            displayName: snapshot.cloud.display_name,
            models: snapshot.cloud.models,
          },
        ]
      : []),
    ...snapshot.providers.map(provider => ({
      id: `provider:${provider.configured_provider_id}`,
      kind: 'provider' as const,
      displayName:
        connectionCountByProviderId.get(provider.provider_definition_id) === 1
          ? provider.display_name
          : `${provider.display_name} · ${provider.connection_display_name}`,
      configuredProviderId: provider.configured_provider_id,
      pickerEnabled: provider.picker_enabled,
      credentialAvailable: provider.credential_available,
      ...(provider.credential_unavailable_reason
        ? { credentialUnavailableReason: provider.credential_unavailable_reason }
        : {}),
      models: provider.models,
    })),
    ...(snapshot.custom_models.length > 0
      ? [
          {
            id: 'custom' as const,
            kind: 'custom' as const,
            displayName: customModelsLabel,
            models: snapshot.custom_models,
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
