import type {
  ModelPickerModelPreference,
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
  private mutationTail: Promise<void> = Promise.resolve();
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

  setProviderVisibility(configuredProviderId: string, visible: boolean): Promise<void> {
    return this.mutate(current => ({
      ...current,
      provider_preferences: [
        ...current.provider_preferences.filter(
          preference => preference.configured_provider_id !== configuredProviderId
        ),
        { configured_provider_id: configuredProviderId, visible },
      ],
    }));
  }

  setModelVisibility(modelConfigId: string, visible: boolean): Promise<void> {
    return this.setModelVisibilities([{ model_config_id: modelConfigId, visible }]);
  }

  /** 一次接入的所有显式选择共享一次持久化，不能发布半批偏好。 */
  setModelVisibilities(preferences: readonly ModelPickerModelPreference[]): Promise<void> {
    const replacements = new Map(
      preferences.map(preference => [preference.model_config_id, { ...preference }])
    );
    return this.mutate(current => ({
      ...current,
      model_preferences: [
        ...current.model_preferences.filter(
          preference => !replacements.has(preference.model_config_id)
        ),
        ...replacements.values(),
      ],
    }));
  }

  removeModelPreference(modelConfigId: string): Promise<void> {
    return this.removeModelPreferences([modelConfigId]);
  }

  removeModelPreferences(modelConfigIds: readonly string[]): Promise<void> {
    const removed = new Set(modelConfigIds);
    return this.mutate(current => ({
      ...current,
      model_preferences: current.model_preferences.filter(
        preference => !removed.has(preference.model_config_id)
      ),
    }));
  }

  /** 必须在排队后读取当前快照，否则两个独立开关会以同一旧值互相覆盖。 */
  private mutate(
    transform: (current: ModelPickerPreferencesSnapshot) => ModelPickerPreferencesSnapshot
  ): Promise<void> {
    const result = this.mutationTail.then(async () => {
      const current = this.requireSnapshot();
      const next = transform(current);
      if (JSON.stringify(next) !== JSON.stringify(current)) await this.commit(next);
    });
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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
