import { describe, expect, it } from 'vitest';
import { createPluginRuntimeError } from '@/app/plugins/definitions/pluginRuntimeErrors';
import { PLUGIN_STORE_MESSAGE_FALLBACKS } from '../definitions/pluginStoreMessageCatalog';
import type { PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';
import { resolvePluginRuntimeUserErrorMessage } from './pluginRuntimeErrorPresentation';

const pluginStoreMessage: PluginStoreMessageResolver = (key, params) => {
  let message = PLUGIN_STORE_MESSAGE_FALLBACKS[key];
  for (const [paramKey, paramValue] of Object.entries(params ?? {})) {
    message = message.replace(`{${paramKey}}`, String(paramValue));
  }
  return message;
};

describe('resolvePluginRuntimeUserErrorMessage', () => {
  it('maps raw dynamic errors to a stable user message', () => {
    expect(resolvePluginRuntimeUserErrorMessage('远程插件源不可达', pluginStoreMessage)).toBe(
      '未知错误',
    );
  });

  it('resolves plugin runtime errors with context through the plugin-store catalog', () => {
    expect(resolvePluginRuntimeUserErrorMessage(
      createPluginRuntimeError('pluginStoreDetailUnavailable', { pluginId: 'sheet' }),
      pluginStoreMessage,
    )).toBe('插件详情不可用：sheet');
  });
});
