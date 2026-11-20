import { BrowserWindow } from 'electron';
import { WORKSPACE_MUTATION_CHANNEL } from '@app/schemas';
import type {
  BackendRendererIntegrationPort,
} from '../../../app-hosts/linnya/desktop-capabilities';
import { subscribeRendererReady } from '../../events/rendererReadyEvent';
import {
  installCloudModelsBroadcaster,
  notifyCloudModelsRendererReady,
} from '../../services/modelCatalog/cloudModelsBroadcaster';
import { getMainWindow } from '../../window-manager';

const PLUGIN_RENDERER_PUSH_CHANNEL = 'plugin:push';

function publishToRenderer(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
}

function publishToPrimaryRenderer(channel: string, payload: unknown): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

export function createElectronBackendRendererIntegrationPort(): BackendRendererIntegrationPort {
  const port: BackendRendererIntegrationPort = {
    async connectModelCatalogUpdates() {
      const uninstallBroadcaster = installCloudModelsBroadcaster(getMainWindow);
      const unsubscribeRendererReady = subscribeRendererReady(notifyCloudModelsRendererReady);
      return () => {
        unsubscribeRendererReady();
        uninstallBroadcaster();
      };
    },
    publishTranscriptionProgress(event) {
      // 保持既有单主窗口语义；多窗口 fanout 属于产品行为变化，不在本次迁移中引入。
      publishToPrimaryRenderer('transcription:progress', event);
    },
    publishWorkspaceMutation(event) {
      publishToRenderer(WORKSPACE_MUTATION_CHANNEL, event);
    },
    publishPluginRendererPush(envelope) {
      publishToRenderer(PLUGIN_RENDERER_PUSH_CHANNEL, envelope);
    },
    publishTodosChanged(projectId) {
      publishToPrimaryRenderer('todos-changed', { projectId });
    },
    publishModelsChanged() {
      // 只发送失效信号；Renderer 先订阅再读取 HTTP，开窗前完成也不会遗漏目录事实。
      publishToPrimaryRenderer('models-updated', undefined);
    },
    publishPluginsChanged() {
      publishToPrimaryRenderer('plugins-changed', undefined);
    },
    publishPluginDataChanged(pluginId) {
      publishToRenderer('plugins-data-changed', pluginId);
    },
  };
  return Object.freeze(port);
}
