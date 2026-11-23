import type { TranscriptionProgressPublisher } from '../../../../features/transcription/definitions/transcriptionProgressPublisher';
import type { WorkspaceMutationPublisher } from '../../../../features/workspace/definitions/workspaceMutationPublisher';
import type { RendererPluginPushEnvelope } from '@linnya/plugin-host-contract/backend/pluginRendererPush';
import type { PluginInstallProgressEvent } from '@app/schemas';

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
  publishPluginDataChanged(pluginId: string): void;
  /** 远程安装进度；只是展示用的过程事实，安装结果仍以 installFromRemote 的返回为准。 */
  publishPluginInstallProgress(event: PluginInstallProgressEvent): void;
  publishModelsChanged(): void;
  /** 运行状态失效信号：不带内容，Renderer 收到后重读 GET /api/v1/conversation/activity。 */
  publishConversationActivityChanged(): void;
  publishScheduledTasksChanged(): void;
}
