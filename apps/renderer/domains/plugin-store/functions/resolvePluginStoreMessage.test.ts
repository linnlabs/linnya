import { describe, expect, it } from 'vitest';
import { resolvePluginStoreMessage } from './resolvePluginStoreMessage';

describe('resolvePluginStoreMessage', () => {
  it('uses plugin store fallback as the domain message fallback', () => {
    expect(resolvePluginStoreMessage(
      'pluginStore.title',
      (key, fallback) => `${key}:${fallback}`,
    )).toBe('pluginStore.title:插件');
  });

  it('passes interpolation params to the app localization resolver', () => {
    expect(resolvePluginStoreMessage(
      'pluginStore.card.viewDetail',
      (key, fallback, params) => `${key}:${fallback}:${params?.pluginName ?? ''}`,
      { pluginName: 'Mindmap' },
    )).toBe('pluginStore.card.viewDetail:查看 {pluginName} 详情:Mindmap');
  });

  it('resolves operation failures without exposing raw error details', () => {
    expect(resolvePluginStoreMessage(
      'pluginStore.error.installFailed',
      (_key, fallback, params) => fallback.replace('{errorMessage}', String(params?.errorMessage ?? '')),
      { errorMessage: 'download failed' },
    )).toBe('插件安装失败，请稍后重试。');
  });
});
