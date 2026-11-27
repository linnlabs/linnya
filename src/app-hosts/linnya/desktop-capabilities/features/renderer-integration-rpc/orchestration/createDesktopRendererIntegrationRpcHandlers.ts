import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { BackendRendererIntegrationPort } from '../../../definitions/backendRendererIntegrationPort';
import {
  DESKTOP_RENDERER_PLUGIN_PUSH_RPC_METHOD,
  DESKTOP_RENDERER_PLUGINS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_PLUGIN_DATA_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_PLUGIN_INSTALL_PROGRESS_RPC_METHOD,
  DESKTOP_RENDERER_MODELS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_CONVERSATION_ACTIVITY_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_SCHEDULED_TASKS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_TRANSCRIPTION_PROGRESS_RPC_METHOD,
  DESKTOP_RENDERER_WORKSPACE_MUTATION_RPC_METHOD,
} from '../definitions/rendererIntegrationRpc';
import {
  RendererIntegrationPluginPushRpcSchema,
  RendererIntegrationPluginDataChangedRpcSchema,
  RendererIntegrationPluginInstallProgressRpcSchema,
  RendererIntegrationTodosChangedRpcSchema,
  RendererIntegrationTranscriptionProgressRpcSchema,
  RendererIntegrationVoidRpcSchema,
  RendererIntegrationWorkspaceMutationRpcSchema,
} from '../functions/rendererIntegrationRpcCodec';

/** Main 只投影已验证的业务事实，不接收 Renderer channel 名或任意 Electron 调用。 */
export function createDesktopRendererIntegrationRpcHandlers(
  port: BackendRendererIntegrationPort,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_RENDERER_TRANSCRIPTION_PROGRESS_RPC_METHOD, payload => {
      port.publishTranscriptionProgress(
        RendererIntegrationTranscriptionProgressRpcSchema.parse(payload),
      );
      return null;
    }],
    [DESKTOP_RENDERER_WORKSPACE_MUTATION_RPC_METHOD, payload => {
      port.publishWorkspaceMutation(RendererIntegrationWorkspaceMutationRpcSchema.parse(payload));
      return null;
    }],
    [DESKTOP_RENDERER_PLUGIN_PUSH_RPC_METHOD, payload => {
      port.publishPluginRendererPush(RendererIntegrationPluginPushRpcSchema.parse(payload));
      return null;
    }],
    [DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD, payload => {
      const request = RendererIntegrationTodosChangedRpcSchema.parse(payload);
      port.publishTodosChanged(request.projectId);
      return null;
    }],
    [DESKTOP_RENDERER_MODELS_CHANGED_RPC_METHOD, payload => {
      RendererIntegrationVoidRpcSchema.parse(payload);
      port.publishModelsChanged();
      return null;
    }],
    [DESKTOP_RENDERER_PLUGINS_CHANGED_RPC_METHOD, payload => {
      RendererIntegrationVoidRpcSchema.parse(payload);
      port.publishPluginsChanged();
      return null;
    }],
    [DESKTOP_RENDERER_PLUGIN_DATA_CHANGED_RPC_METHOD, payload => {
      port.publishPluginDataChanged(RendererIntegrationPluginDataChangedRpcSchema.parse(payload));
      return null;
    }],
    [DESKTOP_RENDERER_PLUGIN_INSTALL_PROGRESS_RPC_METHOD, payload => {
      port.publishPluginInstallProgress(RendererIntegrationPluginInstallProgressRpcSchema.parse(payload));
      return null;
    }],
    [DESKTOP_RENDERER_SCHEDULED_TASKS_CHANGED_RPC_METHOD, payload => {
      RendererIntegrationVoidRpcSchema.parse(payload);
      port.publishScheduledTasksChanged();
      return null;
    }],
    [DESKTOP_RENDERER_CONVERSATION_ACTIVITY_CHANGED_RPC_METHOD, payload => {
      RendererIntegrationVoidRpcSchema.parse(payload);
      port.publishConversationActivityChanged();
      return null;
    }],
  ]);
}
