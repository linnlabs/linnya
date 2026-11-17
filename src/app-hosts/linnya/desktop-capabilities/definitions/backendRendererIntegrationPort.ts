import type { TranscriptionProgressPublisher } from '../../../../features/transcription/definitions/transcriptionProgressPublisher';
import type { WorkspaceMutationPublisher } from '../../../../features/workspace/definitions/workspaceMutationPublisher';
import type { RendererPluginPushEnvelope } from '@linnya/plugin-host-contract/backend/pluginRendererPush';

/**
 * Backend 只发布已有业务事实，不持有 BrowserWindow/WebContents。App Server adapter
 * 将这些调用编码为 reverse desktop capability，Electron adapter 再投影到现有 IPC。
 */
export interface BackendRendererIntegrationPort {
  connectModelCatalogUpdates(): Promise<() => void>;
  readonly publishTranscriptionProgress: TranscriptionProgressPublisher;
  readonly publishWorkspaceMutation: WorkspaceMutationPublisher['publish'];
  publishPluginRendererPush(envelope: RendererPluginPushEnvelope): void;
  publishTodosChanged(projectId: string): void;
  publishPluginsChanged(): void;
  publishModelsChanged(): void;
}
