import { SCHEDULED_TASKS_CHANGED_CHANNEL } from '@app/schemas/scheduled-tasks';
import { BrowserWindow } from 'electron';
import { WORKSPACE_MUTATION_CHANNEL } from '@app/schemas';
import type {
  BackendRendererIntegrationPort,
} from '../../../app-hosts/linnya/desktop-capabilities';

const PLUGIN_RENDERER_PUSH_CHANNEL = 'plugin:push';
const CONVERSATION_ACTIVITY_CHANGED_CHANNEL = 'conversation-activity-changed';

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
    publishPluginInstallProgress(event) {
      // 商店可能开在任一窗口，进度发给所有窗口；离开页面再回来也能接上。
      publishToRenderer('plugins-install-progress', event);
    },
    publishScheduledTasksChanged() { publishToRenderer(SCHEDULED_TASKS_CHANGED_CHANNEL, undefined); },
    publishConversationActivityChanged() {
      // 每个窗口都有侧栏，全部发送；只是失效信号，数据仍由各窗口读 HTTP。
      publishToRenderer(CONVERSATION_ACTIVITY_CHANGED_CHANNEL, undefined);
    },
  };
  return Object.freeze(port);
}
