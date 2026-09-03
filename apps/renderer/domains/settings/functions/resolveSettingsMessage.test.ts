import { describe, expect, it } from 'vitest';
import { resolveSettingsMessage } from './resolveSettingsMessage';

describe('resolveSettingsMessage', () => {
  it('uses settings fallback as the domain message fallback', () => {
    expect(
      resolveSettingsMessage('settings.modal.title', (key, fallback) => `${key}:${fallback}`)
    ).toBe('settings.modal.title:设置');
  });

  it('passes interpolation params to the app localization resolver', () => {
    expect(
      resolveSettingsMessage(
        'settings.modelDetails.confirmDelete',
        (key, fallback, params) => `${key}:${fallback}:${params?.modelName ?? ''}`,
        { modelName: 'gpt-4o' }
      )
    ).toBe(
      'settings.modelDetails.confirmDelete:确定要删除模型“{modelName}”吗？此操作无法撤销。:gpt-4o'
    );
  });
});
