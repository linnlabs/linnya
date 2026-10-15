import { describe, expect, it, vi } from 'vitest';

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
  it('并发修改不同开关和批量偏好不会互相覆盖，失败也不阻断后续写入', async () => {
    const repository = new MemoryRepository({ provider_preferences: [], model_preferences: [] });
    const registry = new ModelPickerPreferencesRegistry(repository);
    await registry.initialize({ configured_provider_ids: ['provider'], model_config_ids: [] });
    let release!: () => void;
    const save = vi.spyOn(repository, 'save');
    save.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    const first = registry.setModelVisibility('a', false);
    const second = registry.setProviderVisibility('provider', false);
    const batch = registry.setModelVisibilities([
      { model_config_id: 'b', visible: false },
      { model_config_id: 'c', visible: true },
    ]);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second, batch]);
    expect(registry.read()).toEqual({
      provider_preferences: [{ configured_provider_id: 'provider', visible: false }],
      model_preferences: [
        { model_config_id: 'a', visible: false },
        { model_config_id: 'b', visible: false },
        { model_config_id: 'c', visible: true },
      ],
    });
    save.mockRejectedValueOnce(new Error('disk full'));
    const failed = registry.setModelVisibility('a', true);
    const succeeding = registry.removeModelPreferences(['b', 'c']);
    await expect(failed).rejects.toThrow('disk full');
    await succeeding;
    expect(registry.read().model_preferences).toEqual([{ model_config_id: 'a', visible: false }]);
  });
});
