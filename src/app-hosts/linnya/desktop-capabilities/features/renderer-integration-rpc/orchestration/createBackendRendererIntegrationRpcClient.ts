import { JsonValueSchema } from '@app/schemas';
import type { ZodType } from 'zod';

import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { BackendRendererIntegrationPort } from '../../../definitions/backendRendererIntegrationPort';
import {
  DESKTOP_RENDERER_MODEL_CATALOG_CONNECT_RPC_METHOD,
  DESKTOP_RENDERER_MODEL_CATALOG_DISCONNECT_RPC_METHOD,
  DESKTOP_RENDERER_PLUGIN_PUSH_RPC_METHOD,
  DESKTOP_RENDERER_PLUGINS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_MODELS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_TRANSCRIPTION_PROGRESS_RPC_METHOD,
  DESKTOP_RENDERER_WORKSPACE_MUTATION_RPC_METHOD,
} from '../definitions/rendererIntegrationRpc';
import {
  RendererIntegrationPluginPushRpcSchema,
  RendererIntegrationTodosChangedRpcSchema,
  RendererIntegrationTranscriptionProgressRpcSchema,
  RendererIntegrationVoidRpcSchema,
  RendererIntegrationWorkspaceMutationRpcSchema,
} from '../functions/rendererIntegrationRpcCodec';

/** App Server 只取得既有 Renderer integration port；raw RPC 不进入业务 feature。 */
export function createBackendRendererIntegrationRpcClient(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly onAsyncFailure: (error: Error) => void;
}): BackendRendererIntegrationPort {
  const publish = (method: string, payload: unknown, schema: ZodType = JsonValueSchema): void => {
    let jsonPayload;
    try {
      jsonPayload = JsonValueSchema.parse(schema.parse(omitAbsentObjectFields(payload)));
    } catch (error: unknown) {
      input.onAsyncFailure(toError(error));
      return;
    }
    void input.rpc
      .request(method, jsonPayload)
      .then(RendererIntegrationVoidRpcSchema.parse)
      .catch((error: unknown) => input.onAsyncFailure(toError(error)));
  };

  const port: BackendRendererIntegrationPort = {
    async connectModelCatalogUpdates() {
      const response = await input.rpc.request(
        DESKTOP_RENDERER_MODEL_CATALOG_CONNECT_RPC_METHOD,
        null
      );
      RendererIntegrationVoidRpcSchema.parse(response);
      return () => publish(DESKTOP_RENDERER_MODEL_CATALOG_DISCONNECT_RPC_METHOD, null);
    },
    publishTranscriptionProgress(event) {
      publish(
        DESKTOP_RENDERER_TRANSCRIPTION_PROGRESS_RPC_METHOD,
        event,
        RendererIntegrationTranscriptionProgressRpcSchema
      );
    },
    publishWorkspaceMutation(event) {
      publish(
        DESKTOP_RENDERER_WORKSPACE_MUTATION_RPC_METHOD,
        event,
        RendererIntegrationWorkspaceMutationRpcSchema
      );
    },
    publishPluginRendererPush(envelope) {
      publish(
        DESKTOP_RENDERER_PLUGIN_PUSH_RPC_METHOD,
        envelope,
        RendererIntegrationPluginPushRpcSchema
      );
    },
    publishTodosChanged(projectId) {
      publish(
        DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD,
        { projectId },
        RendererIntegrationTodosChangedRpcSchema
      );
    },
    publishModelsChanged() {
      publish(DESKTOP_RENDERER_MODELS_CHANGED_RPC_METHOD, null);
    },
    publishPluginsChanged() {
      publish(DESKTOP_RENDERER_PLUGINS_CHANGED_RPC_METHOD, null);
    },
  };
  return Object.freeze(port);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Worker 的结构化克隆会保留可选字段的 undefined；JSON RPC 使用省略字段的语义。
 * 只省略对象内的未提供字段；数组空项、非有限数、函数等仍交由严格 DTO 拒绝。
 */
function omitAbsentObjectFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitAbsentObjectFields);
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, omitAbsentObjectFields(child)])
  );
}
