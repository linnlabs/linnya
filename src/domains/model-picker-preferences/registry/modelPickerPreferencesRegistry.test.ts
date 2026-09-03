import { describe, expect, it } from 'vitest';

import type {
  ModelPickerPreferencesRepository,
  ModelPickerPreferencesSnapshot,
} from '../definitions/modelPickerPreferences';
import { ModelPickerPreferencesRegistry } from './modelPickerPreferencesRegistry';

class MemoryRepository implements ModelPickerPreferencesRepository {
  readonly saves: ModelPickerPreferencesSnapshot[] = [];

  constructor(private snapshot: ModelPickerPreferencesSnapshot) {}

  async load(): Promise<ModelPickerPreferencesSnapshot> {
    return structuredClone(this.snapshot);
  }

  async save(snapshot: ModelPickerPreferencesSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
    this.saves.push(structuredClone(snapshot));
  }
}

describe('ModelPickerPreferencesRegistry', () => {
  it('启动时只清理失效稳定 ID，不为目录默认值生成记录', async () => {
    const repository = new MemoryRepository({
      provider_preferences: [
        { configured_provider_id: 'configured-openai', visible: false },
        { configured_provider_id: 'deleted-provider', visible: true },
      ],
      model_preferences: [
        { model_config_id: 'model-gpt', visible: true },
        { model_config_id: 'deleted-model', visible: false },
      ],
    });
    const registry = new ModelPickerPreferencesRegistry(repository);

    await registry.initialize({
      configured_provider_ids: ['configured-openai'],
      model_config_ids: ['model-gpt', 'model-new'],
    });

    expect(registry.read()).toEqual({
      provider_preferences: [{ configured_provider_id: 'configured-openai', visible: false }],
      model_preferences: [{ model_config_id: 'model-gpt', visible: true }],
    });
    expect(registry.read().model_preferences).not.toContainEqual({
      model_config_id: 'model-new',
      visible: true,
    });
  });

  it('关闭再打开 Provider 时保留全部子模型偏好', async () => {
    const repository = new MemoryRepository({
      provider_preferences: [],
      model_preferences: [
        { model_config_id: 'model-gpt', visible: true },
        { model_config_id: 'model-o3', visible: false },
      ],
    });
    const registry = new ModelPickerPreferencesRegistry(repository);
    await registry.initialize({
      configured_provider_ids: ['configured-openai'],
      model_config_ids: ['model-gpt', 'model-o3'],
    });

    await registry.setProviderVisibility('configured-openai', false);
    await registry.setProviderVisibility('configured-openai', true);

    expect(registry.read().model_preferences).toEqual([
      { model_config_id: 'model-gpt', visible: true },
      { model_config_id: 'model-o3', visible: false },
    ]);
    expect(registry.read().provider_preferences).toEqual([
      { configured_provider_id: 'configured-openai', visible: true },
    ]);
  });

  it('删除模型偏好不影响其他模型和 Provider 开关', async () => {
    const repository = new MemoryRepository({
      provider_preferences: [{ configured_provider_id: 'configured-openai', visible: false }],
      model_preferences: [
        { model_config_id: 'model-gpt', visible: true },
        { model_config_id: 'model-o3', visible: false },
      ],
    });
    const registry = new ModelPickerPreferencesRegistry(repository);
    await registry.initialize({
      configured_provider_ids: ['configured-openai'],
      model_config_ids: ['model-gpt', 'model-o3'],
    });

    await registry.removeModelPreference('model-gpt');

    expect(registry.read()).toEqual({
      provider_preferences: [{ configured_provider_id: 'configured-openai', visible: false }],
      model_preferences: [{ model_config_id: 'model-o3', visible: false }],
    });
  });
});
