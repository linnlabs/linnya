import type {
  StatusUpdatePublisher,
} from '../../../../features/knowledge-base/ingestion/definitions/statusUpdate';
import type { KbGraphProgressPayload } from '../../../../features/knowledge-base/graph/application/graphProgressService';
import type { TranscriptionProgressPublisher } from '../../../../features/transcription/definitions/transcriptionProgressPublisher';
import type { WorkspaceMutationPublisher } from '../../../../features/workspace/definitions/workspaceMutationPublisher';
import type { QueueJobPresentationPublisher } from '../../../../infra/task-queue/definitions/queueJobPresentationPublisher';
import type { RendererPluginPushEnvelope } from '@linnya/plugin-host-contract/backend/pluginRendererPush';

/**
 * Backend 只发布已有业务事实，不持有 BrowserWindow/WebContents。App Server adapter
 * 将这些调用编码为 reverse desktop capability，Electron adapter 再投影到现有 IPC。
 */
export interface BackendRendererIntegrationPort {
  connectModelCatalogUpdates(): Promise<() => void>;
  readonly publishIngestionStatus: StatusUpdatePublisher;
  readonly queueJobPresentationPublisher: QueueJobPresentationPublisher;
  publishKnowledgeGraphProgress(payload: KbGraphProgressPayload): void;
  readonly publishTranscriptionProgress: TranscriptionProgressPublisher;
  readonly publishWorkspaceMutation: WorkspaceMutationPublisher['publish'];
  publishPluginRendererPush(envelope: RendererPluginPushEnvelope): void;
  publishTodosChanged(projectId: string): void;
  publishPluginsChanged(): void;
}
