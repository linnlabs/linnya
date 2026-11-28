import type { CredentialStoragePort } from '../../../../shared/credential-storage';
import type { CommandApprovalControlEndpointPort } from '../../../../domains/commands';
import type { ExternalCommandApprovalPort } from '../../application/conversation-control';
import type { ExternalAuthorizationBrowserPort } from '../../application/provider-account-authorization';
import type { ConversationExecutionRuntimeFactoryPort } from '../../application/conversation-runtime';
import type { QdrantProcessRuntime } from '../../../../infra/adapters/vector-store/qdrant';
import type { QueueWorkerRuntime } from '../../../../infra/task-queue/definitions/queueWorkerRuntime';
import type { LaunchOwnedPipeProcess } from '../../../../shared/process-runtime';
import type {
  BackendRendererIntegrationPort,
  BackendTextMeasurementRuntimeDependencies,
  DesktopHiddenWorkerHostPort,
  DesktopRasterPdfDocumentPort,
} from '../../desktop-capabilities';
import type { ConversationAttentionNotification } from '@app/schemas/conversation-attention';
import type { ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import type { BackendBootstrapFacts } from './backendBootstrapFacts';
import type { WebPageRenderer } from '../../../../tools/web/webread/definitions/webPageRenderer';
import type { AgentToolEnvironment } from './agentToolEnvironment';
import type { DatabaseStartupProgressPort } from '../../../../electron-main/services/database/databaseStartupProgress';

/** Backend 内部长期进程的物理运行依赖；Electron Main 与 App Server 只负责选择 adapter。 */
export interface BackendProcessRuntimeDependencies {
  readonly qdrant: QdrantProcessRuntime;
  readonly launchOwnedPipeProcess: LaunchOwnedPipeProcess;
  readonly queueWorkers: QueueWorkerRuntime;
}

/** Backend 业务 owner 的完整宿主输入；具体实现可以来自 Electron Main 或反向 Desktop RPC。 */
export interface BackendHostDependencies {
  readonly agentToolEnvironment?: AgentToolEnvironment;
  readonly commandApprovalControl: CommandApprovalControlEndpointPort;
  /** 外部命令行能否代用户批准命令；由设置里的开关与宿主启动时的放行共同决定。 */
  readonly externalCommandApproval: ExternalCommandApprovalPort;
  readonly bootstrap: BackendBootstrapFacts;
  /** 数据库启动阶段的进度出口；App Server 经控制协议交给 Desktop Host。 */
  readonly databaseStartupProgress?: DatabaseStartupProgressPort;
  readonly processRuntime: BackendProcessRuntimeDependencies;
  readonly conversationExecutionRuntimeFactory: ConversationExecutionRuntimeFactoryPort;
  readonly credentialStorage: CredentialStoragePort;
  readonly hiddenWorkerHost: DesktopHiddenWorkerHostPort;
  readonly textMeasurement: BackendTextMeasurementRuntimeDependencies;
  readonly notifyScheduledTask?: (event: ScheduledTaskNotification) => Promise<void>;
  /** 只有 Desktop 提供：外部入口发起的运行等用户处理时提醒用户。 */
  readonly notifyConversationAttention?: (event: ConversationAttentionNotification) => Promise<void>;
  readonly readScheduledTaskTimezone?: () => Promise<string>;
  readonly rendererIntegration: BackendRendererIntegrationPort;
  readonly rasterPdfDocument: DesktopRasterPdfDocumentPort;
  readonly externalAuthorizationBrowser: ExternalAuthorizationBrowserPort;
  readonly webPageRenderer: WebPageRenderer;
}
