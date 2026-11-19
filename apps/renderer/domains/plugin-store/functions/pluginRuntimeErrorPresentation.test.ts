import { describe, expect, it } from 'vitest';
import { createPluginRuntimeError, normalizePluginRuntimeUserError } from '@/app/plugins/definitions/pluginRuntimeErrors';
import { PLUGIN_STORE_MESSAGE_FALLBACKS } from '../definitions/pluginStoreMessageCatalog';
import type { PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';
import { resolvePluginRuntimeUserErrorMessage } from './pluginRuntimeErrorPresentation';

const pluginStoreMessage: PluginStoreMessageResolver = (key, params) => {
  let message: string = PLUGIN_STORE_MESSAGE_FALLBACKS[key];
  for (const [paramKey, paramValue] of Object.entries(params ?? {})) {
    message = message.replace(`{${paramKey}}`, String(paramValue));
  }
  return message;
};

describe('resolvePluginRuntimeUserErrorMessage', () => {
  it('keeps raw dynamic errors so installation failures expose the actionable reason', () => {
    expect(resolvePluginRuntimeUserErrorMessage('远程插件源不可达', pluginStoreMessage)).toBe(
      '远程插件源不可达',
    );
  });

  it('resolves plugin runtime errors with context through the plugin-store catalog', () => {
    expect(resolvePluginRuntimeUserErrorMessage(
      createPluginRuntimeError('pluginStoreDetailUnavailable', { pluginId: 'sheet' }),
      pluginStoreMessage,
    )).toBe('插件详情不可用：sheet');
  });

  it('maps structured Host operation failures to localized product copy', () => {
    const error = normalizePluginRuntimeUserError({ code: 'version-conflict', pluginId: 'knowledge' });
    expect(resolvePluginRuntimeUserErrorMessage(error, pluginStoreMessage)).toBe(
      '已有相同版本的插件文件内容不同，请提升插件版本后再安装。',
    );
  });
});
