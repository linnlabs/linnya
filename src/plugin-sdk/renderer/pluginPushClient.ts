/**
 * @file pluginPushClient.ts
 * @description 渲染端插件 push 事件订阅客户端。
 */

interface PluginPushElectronApi {
  'plugin:onPush': (
    pluginId: string,
    channel: string,
    callback: (payload: unknown) => void,
  ) => (() => void) | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPluginPushApi(): PluginPushElectronApi {
  const api = (window as Window & { electronAPI?: unknown }).electronAPI;
  if (!isRecord(api) || typeof api['plugin:onPush'] !== 'function') {
    throw new Error('[pluginPushClient] window.electronAPI.plugin:onPush is not available');
  }
  return {
    'plugin:onPush': api['plugin:onPush'] as PluginPushElectronApi['plugin:onPush'],
  };
}

export function onRendererPluginPush(
  pluginId: string,
  channel: string,
  callback: (payload: unknown) => void,
): () => void {
  return getPluginPushApi()['plugin:onPush'](pluginId, channel, callback) ?? (() => {});
}
