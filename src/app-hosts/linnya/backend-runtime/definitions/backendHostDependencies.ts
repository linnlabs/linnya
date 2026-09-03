import type { ExternalAuthorizationBrowserPort } from '../../application/provider-account-authorization';
import type { ConversationExecutionRuntimeFactoryPort } from '../../application/conversation-runtime';
import type { QdrantProcessRuntime } from '../../../../infra/adapters/vector-store/qdrant';
import type { QueueWorkerRuntime } from '../../../../infra/task-queue/definitions/queueWorkerRuntime';
import type { LaunchOwnedPipeProcess } from '../../../../shared/process-runtime';
import type {
  BackendRendererIntegrationPort,
  BackendTextMeasurementRuntimeDependencies,
  DesktopCredentialProtectionPort,
  DesktopHiddenWorkerHostPort,
  DesktopRasterPdfDocumentPort,
} from '../../desktop-capabilities';
import type { BackendBootstrapFacts } from './backendBootstrapFacts';
import type { WebPageRenderer } from '../../../../tools/web/webread/definitions/webPageRenderer';

/** Backend 内部长期进程的物理运行依赖；Electron Main 与 App Server 只负责选择 adapter。 */
export interface BackendProcessRuntimeDependencies {
  readonly qdrant: QdrantProcessRuntime;
  readonly launchOwnedPipeProcess: LaunchOwnedPipeProcess;
  readonly queueWorkers: QueueWorkerRuntime;
}

/** Backend 业务 owner 的完整宿主输入；具体实现可以来自 Electron Main 或反向 Desktop RPC。 */
export interface BackendHostDependencies {
  readonly bootstrap: BackendBootstrapFacts;
  readonly processRuntime: BackendProcessRuntimeDependencies;
  readonly conversationExecutionRuntimeFactory: ConversationExecutionRuntimeFactoryPort;
  readonly credentialProtection: DesktopCredentialProtectionPort;
  readonly hiddenWorkerHost: DesktopHiddenWorkerHostPort;
  readonly textMeasurement: BackendTextMeasurementRuntimeDependencies;
  readonly rendererIntegration: BackendRendererIntegrationPort;
  readonly rasterPdfDocument: DesktopRasterPdfDocumentPort;
  readonly externalAuthorizationBrowser: ExternalAuthorizationBrowserPort;
  readonly webPageRenderer: WebPageRenderer;
}
