import { JsonValueSchema } from '@app/schemas';

import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { BackendRendererIntegrationPort } from '../../../definitions/backendRendererIntegrationPort';
import type { QueueJobPresentationPublisher } from '../../../../../../infra/task-queue/definitions/queueJobPresentationPublisher';
import {
  DESKTOP_RENDERER_INGESTION_STATUS_RPC_METHOD,
  DESKTOP_RENDERER_KNOWLEDGE_GRAPH_PROGRESS_RPC_METHOD,
  DESKTOP_RENDERER_MODEL_CATALOG_CONNECT_RPC_METHOD,
  DESKTOP_RENDERER_MODEL_CATALOG_DISCONNECT_RPC_METHOD,
  DESKTOP_RENDERER_PLUGIN_PUSH_RPC_METHOD,
  DESKTOP_RENDERER_PLUGINS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_QUEUE_COMPLETION_RPC_METHOD,
  DESKTOP_RENDERER_QUEUE_FAILURE_RPC_METHOD,
  DESKTOP_RENDERER_QUEUE_PROGRESS_RPC_METHOD,
  DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD,
  DESKTOP_RENDERER_TRANSCRIPTION_PROGRESS_RPC_METHOD,
  DESKTOP_RENDERER_WORKSPACE_MUTATION_RPC_METHOD,
} from '../definitions/rendererIntegrationRpc';
import {
  RendererIntegrationIngestionStatusRpcSchema,
  RendererIntegrationKnowledgeGraphProgressRpcSchema,
  RendererIntegrationPluginPushRpcSchema,
  RendererIntegrationQueueCompletionRpcSchema,
  RendererIntegrationQueueFailureRpcSchema,
  RendererIntegrationQueueProgressRpcSchema,
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
  const publish = (method: string, payload: unknown): void => {
    let jsonPayload;
    try {
      jsonPayload = JsonValueSchema.parse(payload);
    } catch (error: unknown) {
      input.onAsyncFailure(toError(error));
      return;
    }
    void input.rpc.request(method, jsonPayload)
      .then(RendererIntegrationVoidRpcSchema.parse)
      .catch((error: unknown) => input.onAsyncFailure(toError(error)));
  };

  const queueJobPresentationPublisher: QueueJobPresentationPublisher = {
    publishProgress(event) {
      publish(
        DESKTOP_RENDERER_QUEUE_PROGRESS_RPC_METHOD,
        RendererIntegrationQueueProgressRpcSchema.parse(event),
      );
    },
    publishCompletion(event) {
      publish(
        DESKTOP_RENDERER_QUEUE_COMPLETION_RPC_METHOD,
        RendererIntegrationQueueCompletionRpcSchema.parse(event),
      );
    },
    publishFailure(event) {
      publish(
        DESKTOP_RENDERER_QUEUE_FAILURE_RPC_METHOD,
        RendererIntegrationQueueFailureRpcSchema.parse(event),
      );
    },
  };

  const port: BackendRendererIntegrationPort = {
    async connectModelCatalogUpdates() {
      const response = await input.rpc.request(
        DESKTOP_RENDERER_MODEL_CATALOG_CONNECT_RPC_METHOD,
        null,
      );
      RendererIntegrationVoidRpcSchema.parse(response);
      return () => publish(DESKTOP_RENDERER_MODEL_CATALOG_DISCONNECT_RPC_METHOD, null);
    },
    publishIngestionStatus(event) {
      publish(
        DESKTOP_RENDERER_INGESTION_STATUS_RPC_METHOD,
        RendererIntegrationIngestionStatusRpcSchema.parse(event),
      );
    },
    queueJobPresentationPublisher: Object.freeze(queueJobPresentationPublisher),
    publishKnowledgeGraphProgress(event) {
      publish(
        DESKTOP_RENDERER_KNOWLEDGE_GRAPH_PROGRESS_RPC_METHOD,
        RendererIntegrationKnowledgeGraphProgressRpcSchema.parse(event),
      );
    },
    publishTranscriptionProgress(event) {
      publish(
        DESKTOP_RENDERER_TRANSCRIPTION_PROGRESS_RPC_METHOD,
        RendererIntegrationTranscriptionProgressRpcSchema.parse(event),
      );
    },
    publishWorkspaceMutation(event) {
      publish(
        DESKTOP_RENDERER_WORKSPACE_MUTATION_RPC_METHOD,
        RendererIntegrationWorkspaceMutationRpcSchema.parse(event),
      );
    },
    publishPluginRendererPush(envelope) {
      publish(
        DESKTOP_RENDERER_PLUGIN_PUSH_RPC_METHOD,
        RendererIntegrationPluginPushRpcSchema.parse(envelope),
      );
    },
    publishTodosChanged(projectId) {
      publish(
        DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD,
        RendererIntegrationTodosChangedRpcSchema.parse({ projectId }),
      );
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
