import type { IpcRenderer, IpcRendererEvent } from 'electron';

function isPluginPushEnvelope(value: unknown): value is {
  readonly pluginId: string;
  readonly channel: string;
  readonly payload: unknown;
} {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'pluginId') === 'string'
    && typeof Reflect.get(value, 'channel') === 'string';
}

export function buildPluginsPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    'plugin:invoke': (pluginId: string, channel: string, payload: unknown) =>
      ipcRenderer.invoke('plugin:invoke', { pluginId, channel, payload }),
    'plugin:onPush': (
      pluginId: string,
      channel: string,
      callback: (payload: unknown) => void,
    ) => {
      const handler = (_event: IpcRendererEvent, envelope: unknown) => {
        if (!isPluginPushEnvelope(envelope)) return;
        if (envelope.pluginId !== pluginId || envelope.channel !== channel) return;
        callback(envelope.payload);
      };
      ipcRenderer.on('plugin:push', handler);
      return () => ipcRenderer.removeListener('plugin:push', handler);
    },
    plugins: {
      list: () => ipcRenderer.invoke('plugins:list'),
      storeList: () => ipcRenderer.invoke('plugins:store-list'),
      getDetail: (pluginId: string) => ipcRenderer.invoke('plugins:get-detail', pluginId),
      diagnostics: () => ipcRenderer.invoke('plugins:diagnostics'),
      rendererEntries: () => ipcRenderer.invoke('plugins:renderer-entries'),
      checkRemoteUpdate: (pluginId: string) => ipcRenderer.invoke('plugins:checkRemoteUpdate', pluginId),
      installFromRemote: (pluginId: string) => ipcRenderer.invoke('plugins:installFromRemote', pluginId),
      uninstall: (pluginId: string) => ipcRenderer.invoke('plugins:uninstall', pluginId),
      setEnabled: (pluginId: string, enabled: boolean) =>
        ipcRenderer.invoke('plugins:set-enabled', pluginId, enabled),
      onChanged: (cb: () => void) => {
        const handler = () => cb();
        ipcRenderer.on('plugins-changed', handler);
        return () => ipcRenderer.removeListener('plugins-changed', handler);
      },
    },
  };
}
