import type { AppServerRpcHandlerRegistry } from '../../app-server-rpc';
import type { BackendHostDependencies } from '../../backend-runtime';
import type { DesktopFileRevealPort } from '../../desktop-capabilities';
import type { PluginCredentialRuntimePort } from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';
import type { ExportArtifactCommitPort } from '../../../../features/system/export/definitions/exportArtifactCommitPort';

export interface HeadlessAppServerBackendComposition {
  readonly backendHostDependencies: BackendHostDependencies;
  readonly backendRpcHandlers: AppServerRpcHandlerRegistry;
  readonly fileReveal: DesktopFileRevealPort;
  readonly exportArtifactCommit: ExportArtifactCommitPort;
  readonly pluginCredentialRuntime: PluginCredentialRuntimePort;
  dispose(): void;
}
