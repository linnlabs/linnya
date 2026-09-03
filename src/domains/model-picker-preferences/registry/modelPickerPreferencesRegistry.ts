import type {
  ModelPickerPreferenceIdentities,
  ModelPickerPreferencesRepository,
  ModelPickerPreferencesSnapshot,
} from '../definitions/modelPickerPreferences';
import { fileModelPickerPreferencesRepository } from '../features/preference-persistence/orchestration/fileModelPickerPreferencesRepository';

function cloneSnapshot(snapshot: ModelPickerPreferencesSnapshot): ModelPickerPreferencesSnapshot {
  return {
    provider_preferences: snapshot.provider_preferences.map(preference => ({ ...preference })),
    model_preferences: snapshot.model_preferences.map(preference => ({ ...preference })),
  };
}

function reconcileSnapshot(
  snapshot: ModelPickerPreferencesSnapshot,
  identities: ModelPickerPreferenceIdentities
): ModelPickerPreferencesSnapshot {
  const configuredProviderIds = new Set(identities.configured_provider_ids);
  const modelConfigIds = new Set(identities.model_config_ids);
  return {
    provider_preferences: snapshot.provider_preferences.filter(preference =>
      configuredProviderIds.has(preference.configured_provider_id)
    ),
    model_preferences: snapshot.model_preferences.filter(preference =>
      modelConfigIds.has(preference.model_config_id)
    ),
  };
}

export class ModelPickerPreferencesRegistry {
  private snapshot: ModelPickerPreferencesSnapshot | null = null;

  constructor(private readonly repository: ModelPickerPreferencesRepository) {}

  async initialize(identities: ModelPickerPreferenceIdentities): Promise<void> {
    if (this.snapshot) return;
    const loaded = await this.repository.load();
    const reconciled = reconcileSnapshot(loaded, identities);
    if (JSON.stringify(reconciled) !== JSON.stringify(loaded)) {
      await this.repository.save(reconciled);
    }
    this.snapshot = cloneSnapshot(reconciled);
  }

  read(): ModelPickerPreferencesSnapshot {
    return cloneSnapshot(this.requireSnapshot());
  }

  async setProviderVisibility(configuredProviderId: string, visible: boolean): Promise<void> {
    const current = this.requireSnapshot();
    const next: ModelPickerPreferencesSnapshot = {
      ...cloneSnapshot(current),
      provider_preferences: [
        ...current.provider_preferences.filter(
          preference => preference.configured_provider_id !== configuredProviderId
        ),
        { configured_provider_id: configuredProviderId, visible },
      ],
    };
    await this.commit(next);
  }

  async setModelVisibility(modelConfigId: string, visible: boolean): Promise<void> {
    const current = this.requireSnapshot();
    const next: ModelPickerPreferencesSnapshot = {
      ...cloneSnapshot(current),
      model_preferences: [
        ...current.model_preferences.filter(
          preference => preference.model_config_id !== modelConfigId
        ),
        { model_config_id: modelConfigId, visible },
      ],
    };
    await this.commit(next);
  }

  async removeModelPreference(modelConfigId: string): Promise<void> {
    const current = this.requireSnapshot();
    if (!current.model_preferences.some(item => item.model_config_id === modelConfigId)) return;
    await this.commit({
      ...cloneSnapshot(current),
      model_preferences: current.model_preferences.filter(
        preference => preference.model_config_id !== modelConfigId
      ),
    });
  }

  private requireSnapshot(): ModelPickerPreferencesSnapshot {
    if (!this.snapshot) throw new Error('ModelPickerPreferencesRegistry 尚未初始化');
    return this.snapshot;
  }

  private async commit(snapshot: ModelPickerPreferencesSnapshot): Promise<void> {
    await this.repository.save(snapshot);
    this.snapshot = cloneSnapshot(snapshot);
  }
}

export const modelPickerPreferencesRegistry = new ModelPickerPreferencesRegistry(
  fileModelPickerPreferencesRepository
);
