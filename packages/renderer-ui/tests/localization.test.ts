import { describe, expect, it } from 'vitest';
import { resolveSharedComponentMessage } from '../src/localization';

describe('resolveSharedComponentMessage', () => {
  it('uses shared component fallback as the message fallback', () => {
    expect(resolveSharedComponentMessage(
      'shared.alert.confirm',
      (key, fallback) => `${key}:${fallback}`,
    )).toBe('shared.alert.confirm:确定');
  });

  it('passes interpolation params to the app-level resolver port', () => {
    expect(resolveSharedComponentMessage(
      'shared.characterCount.label',
      (key, fallback, params) => `${key}:${fallback}:${params?.count ?? ''}`,
      { count: 128 },
    )).toBe('shared.characterCount.label:字数: {count}:128');
  });

  it('resolves TimePicker default labels from shared component fallbacks', () => {
    expect(resolveSharedComponentMessage(
      'shared.timePicker.placeholder',
      (key, fallback) => `${key}:${fallback}`,
    )).toBe('shared.timePicker.placeholder:选择时间');
  });

  it('resolves ColorPicker default labels from shared component fallbacks', () => {
    expect(resolveSharedComponentMessage(
      'shared.colorPicker.clear',
      (key, fallback) => `${key}:${fallback}`,
    )).toBe('shared.colorPicker.clear:清除颜色');

    expect(resolveSharedComponentMessage(
      'shared.color.blue',
      (key, fallback) => `${key}:${fallback}`,
    )).toBe('shared.color.blue:蓝色');
  });

  it('resolves SecretInput visibility labels from shared component fallbacks', () => {
    expect(resolveSharedComponentMessage(
      'shared.secretInput.show',
      (key, fallback) => `${key}:${fallback}`,
    )).toBe('shared.secretInput.show:显示敏感内容');
  });
});
