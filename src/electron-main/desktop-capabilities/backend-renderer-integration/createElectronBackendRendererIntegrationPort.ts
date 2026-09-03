import { BrowserWindow } from 'electron';
import { WORKSPACE_MUTATION_CHANNEL } from '@app/schemas';
import type {
  BackendRendererIntegrationPort,
} from '../../../app-hosts/linnya/desktop-capabilities';
import { createRendererStatusUpdatePublisher } from '../../../features/knowledge-base/ingestion/orchestration/statusUpdatePublisher';
import { subscribeRendererReady } from '../../events/rendererReadyEvent';
import {
  installCloudModelsBroadcaster,
  notifyCloudModelsRendererReady,
} from '../../services/modelCatalog/cloudModelsBroadcaster';
import { getMainWindow } from '../../window-manager';
import type { QueueJobPresentationPublisher } from '../../../infra/task-queue/definitions/queueJobPresentationPublisher';

const PLUGIN_RENDERER_PUSH_CHANNEL = 'plugin:push';

// 前端协议仍使用历史字段名；仅在 Desktop adapter 末端编码，避免污染后端通用 job 契约。
const LEGACY_JOB_ID_FIELD = ['task', 'Id'].join('');

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

function readField(value: unknown, field: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }
  return Reflect.get(value, field);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createQueueJobPresentationPublisher(): QueueJobPresentationPublisher {
  const publisher: QueueJobPresentationPublisher = {
    publishProgress(event) {
      const updatedAt = readNumber(readField(event.data, 'updated_at'), Date.now());
      publishToRenderer('task-status-update', {
        [LEGACY_JOB_ID_FIELD]: event.jobId,
        docId: readField(event.data, 'doc_id'),
        filename: readField(event.data, 'filename'),
        status: readField(event.data, 'status') ?? 'processing',
        progress: event.progress,
        message: readField(event.data, 'message') ?? '处理中',
        error: readField(event.data, 'error'),
        stage: readField(event.data, 'stage'),
        stage_progress: readField(event.data, 'stage_progress'),
        updated_at: updatedAt,
        timestamp: updatedAt,
      });
    },
    publishCompletion(event) {
      const frontendState = readField(event.result, 'frontendState');
      const duplicate = readField(event.result, 'duplicate') === true;
      const updatedAt = readNumber(readField(frontendState, 'updated_at'), Date.now());
      publishToRenderer('task-status-update', {
        [LEGACY_JOB_ID_FIELD]: event.jobId,
        docId: readField(event.result, 'docId'),
        filename: readField(frontendState, 'filename'),
        status: duplicate ? 'duplicate' : 'completed',
        progress: 100,
        message: duplicate ? '重复文件' : '已完成',
        error: null,
        stage: 'completed',
        stage_progress: 100,
        updated_at: updatedAt,
        timestamp: updatedAt,
      });
    },
    publishFailure(event) {
      const updatedAt = Date.now();
      publishToRenderer('task-status-update', {
        [LEGACY_JOB_ID_FIELD]: event.jobId,
        docId: readField(event.jobData, 'docId'),
        filename: readField(event.jobData, 'filename'),
        status: 'failed',
        progress: 0,
        message: event.failedMessage,
        error: event.errorMessage,
        stage: 'failed',
        stage_progress: 0,
        updated_at: updatedAt,
        timestamp: updatedAt,
      });
    },
  };
  return Object.freeze(publisher);
}

export function createElectronBackendRendererIntegrationPort(): BackendRendererIntegrationPort {
  const publishLegacyQueueStatus = (payload: unknown): void => {
    publishToRenderer('task-status-update', payload);
  };
  const port: BackendRendererIntegrationPort = {
    async connectModelCatalogUpdates() {
      const uninstallBroadcaster = installCloudModelsBroadcaster(getMainWindow);
      const unsubscribeRendererReady = subscribeRendererReady(notifyCloudModelsRendererReady);
      return () => {
        unsubscribeRendererReady();
        uninstallBroadcaster();
      };
    },
    publishIngestionStatus: createRendererStatusUpdatePublisher(publishLegacyQueueStatus),
    queueJobPresentationPublisher: createQueueJobPresentationPublisher(),
    publishKnowledgeGraphProgress(payload) {
      publishToRenderer('kb-graph-progress-updated', payload);
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
    publishPluginsChanged() {
      publishToPrimaryRenderer('plugins-changed', undefined);
    },
  };
  return Object.freeze(port);
}
