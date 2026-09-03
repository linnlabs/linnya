import { describe, expect, it } from 'vitest';

import { readModelPickerPreferencesFile } from './modelPickerPreferencesFile';

describe('readModelPickerPreferencesFile', () => {
  it('严格读取当前单版本稀疏偏好', () => {
    expect(
      readModelPickerPreferencesFile({
        version: '1.0.0',
        last_updated: '2026-08-20T00:00:00.000Z',
        provider_preferences: [{ configured_provider_id: 'configured-openai', visible: false }],
        model_preferences: [{ model_config_id: 'model-gpt', visible: true }],
      })
    ).toEqual({
      provider_preferences: [{ configured_provider_id: 'configured-openai', visible: false }],
      model_preferences: [{ model_config_id: 'model-gpt', visible: true }],
    });
  });

  it('拒绝未知字段和重复稳定 ID', () => {
    expect(() =>
      readModelPickerPreferencesFile({
        version: '1.0.0',
        last_updated: '2026-08-20T00:00:00.000Z',
        provider_preferences: [],
        model_preferences: [],
        fallback_visibility: true,
      })
    ).toThrow('包含未知字段');

    expect(() =>
      readModelPickerPreferencesFile({
        version: '1.0.0',
        last_updated: '2026-08-20T00:00:00.000Z',
        provider_preferences: [],
        model_preferences: [
          { model_config_id: 'model-gpt', visible: true },
          { model_config_id: 'model-gpt', visible: false },
        ],
      })
    ).toThrow('包含重复 ID');
  });
});
