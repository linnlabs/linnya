import type {
  BeginProviderModelRemovalInput,
  PendingProviderModelRemoval,
} from 'src/domains/provider-configuration';

export interface ConfiguredModelRemovalCatalogPort {
  removeModel(modelId: string): Promise<void>;
}

export interface ConfiguredModelRemovalConfigurationPort {
  beginModelRemoval(
    input: BeginProviderModelRemovalInput
  ): Promise<PendingProviderModelRemoval | null>;
  completeModelRemoval(intentId: string): Promise<void>;
  cancelModelRemoval(intentId: string): Promise<void>;
}

export interface ConfiguredModelRemovalPreferencesPort {
  removeModelPreference(modelId: string): Promise<void>;
}

export interface ConfiguredModelRemovalIdFactory {
  create(): string;
}

export interface ConfiguredModelRemovalResult {
  readonly provider_association_recovery_pending: boolean;
  readonly model_picker_preference_recovery_pending: boolean;
}

export interface ConfiguredModelRemovalUseCase {
  remove(modelId: string): Promise<ConfiguredModelRemovalResult>;
}
