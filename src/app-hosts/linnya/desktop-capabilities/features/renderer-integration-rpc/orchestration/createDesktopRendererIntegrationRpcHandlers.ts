import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { BackendRendererIntegrationPort } from '../../../definitions/backendRendererIntegrationPort';
import {
  DESKTOP_RENDERER_MODEL_CATALOG_CONNECT_RPC_METHOD,
  DESKTOP_RENDERER_MODEL_CATALOG_DISCONNECT_RPC_METHOD,
  DESKTOP_RENDERER_PLUGIN_PUSH_RPC_METHOD,
  DESKTOP_RENDERER_PLUGINS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_PLUGIN_DATA_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_MODELS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_TRANSCRIPTION_PROGRESS_RPC_METHOD,
  DESKTOP_RENDERER_WORKSPACE_MUTATION_RPC_METHOD,
} from '../definitions/rendererIntegrationRpc';
import {
  RendererIntegrationPluginPushRpcSchema,
  RendererIntegrationPluginDataChangedRpcSchema,
  RendererIntegrationTodosChangedRpcSchema,
  RendererIntegrationTranscriptionProgressRpcSchema,
  RendererIntegrationVoidRpcSchema,
  RendererIntegrationWorkspaceMutationRpcSchema,
} from '../functions/rendererIntegrationRpcCodec';

/** Main 只投影已验证的业务事实，不接收 Renderer channel 名或任意 Electron 调用。 */
export function createDesktopRendererIntegrationRpcHandlers(
  port: BackendRendererIntegrationPort,
): AppServerRpcHandlerRegistry {
  let disconnectModelCatalogUpdates: (() => void) | null = null;
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_RENDERER_MODEL_CATALOG_CONNECT_RPC_METHOD, async payload => {
      RendererIntegrationVoidRpcSchema.parse(payload);
      if (disconnectModelCatalogUpdates) {
        throw new Error('Model Catalog Renderer bridge 已连接');
      }
      disconnectModelCatalogUpdates = await port.connectModelCatalogUpdates();
      return null;
    }],
    [DESKTOP_RENDERER_MODEL_CATALOG_DISCONNECT_RPC_METHOD, payload => {
      RendererIntegrationVoidRpcSchema.parse(payload);
      disconnectModelCatalogUpdates?.();
      disconnectModelCatalogUpdates = null;
      return null;
    }],
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
  ]);
}
