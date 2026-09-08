import path from 'node:path';
import type { Writable } from 'node:stream';

import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../app-hosts/linnya/app-server-rpc';
import {
  createBackendRendererRequestRpcGateway,
  resolveBackendRendererRequestMailboxRoot,
} from '../../../app-hosts/linnya/adapters/backend-renderer-requests';
import {
  createCommandDesktopRpcGateways,
} from '../../../app-hosts/linnya/adapters/commands/renderer-rpc';
import {
  createDesktopCredentialProtectionRpcHandlers,
  createDesktopFileRevealRpcHandlers,
  createDesktopHiddenWorkerHostRpcHandlers,
  createDesktopRasterPdfDocumentRpcHandlers,
  createDesktopRendererIntegrationRpcHandlers,
  createDesktopTextMeasurementWorkerRpcHandlers,
  createDesktopWebPageRendererRpcHandlers,
} from '../../../app-hosts/linnya/desktop-capabilities';
import {
  createExternalAuthorizationBrowserRpcHandlers,
} from '../../../app-hosts/linnya/application/provider-account-authorization';
import { createAppServerActivityRpcGateway } from '../../../app-hosts/linnya/app-server-runtime/features/activity-rpc';
import type { AppServerProcessLaunch } from '../../../infra/adapters/app-server-process';
import { createNodeAppServerProcessSupervisor } from '../../../infra/adapters/app-server-process';
import type { AppServerBackendConfiguration } from '../../../app-hosts/linnya/app-server-bootstrap';
import type { BackendBootstrapFacts } from '../../../app-hosts/linnya/backend-runtime';
import type { HostProcessEnvironment } from '../../../infra/adapters/command-runtime/environment';
import { WebPageRenderManager } from '../../web-render/WebPageRenderManager';
import { createElectronCredentialProtectionPort } from '../../desktop-capabilities/credential-protection';
import { createElectronFileRevealPort } from '../../desktop-capabilities/file-reveal';
import { createElectronBackendRendererIntegrationPort } from '../../desktop-capabilities/backend-renderer-integration';
import { createElectronDesktopHiddenWorkerHostPort } from '../../desktop-capabilities/backend-hidden-worker-runtime';
import { createElectronTextMeasurementWorkerRuntime } from '../../desktop-capabilities/text-measurement-worker';
import { createElectronExternalAuthorizationBrowserPort } from '../../desktop-capabilities/external-authorization-browser';
import { electronPdfDocumentRuntime } from '../../desktop-capabilities/pdf-document';
import type { PluginRuntimeEnvironmentResult } from '../../plugins/loader/pluginRuntimeBootstrap';
import type { RuntimePathRoots } from '../../../shared/runtime-paths';
import type { ElectronAppServerRuntime } from '../definitions/electronAppServerRuntime';
import { createHiddenWorkerArtifactAdmission } from '../functions/assertHiddenWorkerDescriptorAllowed';
import { resolveElectronAppServerProcessLaunch } from './resolveElectronAppServerProcessLaunch';
import { createPluginCredentialRuntimeRpcHandlers } from '../../../app-hosts/linnya/plugin-registry/features/credential-runtime-rpc';
import { createFilePluginCredentialRuntimePort } from '../../../plugin-sdk/backend/filePluginCredentialRuntime';
import { store } from '../../store/index.js';
import { createExportArtifactCommitRpcHandlers } from '../../../app-hosts/linnya/application/export-artifact-commit';
import { commitAuthorizedExportArtifact } from '../../../features/system/export/orchestration/exportArtifactTargetRuntime';
import { createDesktopDiagnosticLogRpcHandlers } from '../../../app-hosts/linnya/app-server-runtime/features/diagnostic-log-rpc';
import { writeForwardedDiagnosticLogRecord } from '../../../shared/logger';

/** Electron Main 的唯一 App Server composition；这里只保留真实 Desktop capability owner。 */
export async function createElectronAppServerRuntime(input: {
  readonly backendConfiguration: AppServerBackendConfiguration;
  readonly backendFacts: BackendBootstrapFacts;
  readonly commandHostEnvironment: HostProcessEnvironment;
  readonly processEnvironment: NodeJS.ProcessEnv;
  readonly runtimePathRoots: RuntimePathRoots;
  readonly packaged: boolean;
  readonly pluginRuntime: PluginRuntimeEnvironmentResult;
  readonly directPluginDirectories: readonly string[];
  readonly backendStderrSink: Writable;
  readonly onAsyncFailure: (error: Error) => void;
}): Promise<ElectronAppServerRuntime> {
  const mailboxRoot = resolveBackendRendererRequestMailboxRoot(
    input.runtimePathRoots.appDataRoot,
  );
  const textMeasurement = createElectronTextMeasurementWorkerRuntime();
  let launch: AppServerProcessLaunch;
  try {
    launch = await resolveElectronAppServerProcessLaunch({
      backendConfiguration: input.backendConfiguration,
      backendFacts: input.backendFacts,
      commandHostEnvironment: input.commandHostEnvironment,
      processEnvironment: input.processEnvironment,
      textMeasurement: {
        useBrowserPretext: input.processEnvironment.MEASUREMENT_USE_MAIN_PRETEXT !== 'false',
        useHarfBuzz: input.processEnvironment.MEASUREMENT_USE_HARFBUZZ !== 'false',
        availability: textMeasurement.port.availability,
      },
    });
  } catch (error: unknown) {
    await textMeasurement.dispose();
    throw error;
  }
  const webPageRenderer = WebPageRenderManager.instance();
  const hiddenWorkerAdmission = createHiddenWorkerArtifactAdmission([
    input.pluginRuntime.userPluginRoot,
    ...(input.pluginRuntime.bundledPluginRoot ? [input.pluginRuntime.bundledPluginRoot] : []),
    ...input.directPluginDirectories.map(directory => (
      path.isAbsolute(directory)
        ? directory
        : path.resolve(input.runtimePathRoots.developmentRoot, directory)
    )),
    ...(!input.packaged
      ? [path.join(input.runtimePathRoots.developmentRoot, 'packages', 'plugins')]
      : []),
  ]);
  const rpcHandlers = new Map<string, AppServerRpcHandler>();
  const credentialProtection = createElectronCredentialProtectionPort();
  const pluginCredentialRuntime = await createFilePluginCredentialRuntimePort({
    filePath: path.join(input.runtimePathRoots.appDataRoot, 'config', 'plugin_credentials.json'),
    credentialProtection,
    legacyStore: store,
  });
  registerHandlers(rpcHandlers, createDesktopDiagnosticLogRpcHandlers({
    writeRecord: writeForwardedDiagnosticLogRecord,
  }));
  registerHandlers(rpcHandlers, createDesktopCredentialProtectionRpcHandlers(
    credentialProtection,
  ));
  registerHandlers(rpcHandlers, createPluginCredentialRuntimeRpcHandlers(
    pluginCredentialRuntime,
  ));
  registerHandlers(rpcHandlers, createExportArtifactCommitRpcHandlers({
    mailboxRoot,
    port: Object.freeze({ commit: commitAuthorizedExportArtifact }),
  }));
  registerHandlers(rpcHandlers, createDesktopFileRevealRpcHandlers(
    createElectronFileRevealPort(),
  ));
  registerHandlers(rpcHandlers, createDesktopHiddenWorkerHostRpcHandlers({
    port: createElectronDesktopHiddenWorkerHostPort(),
    mailboxRoot,
    assertDescriptorAllowed: descriptor => hiddenWorkerAdmission.assertDescriptorAllowed(descriptor),
  }));
  registerHandlers(rpcHandlers, createDesktopTextMeasurementWorkerRpcHandlers({
    port: textMeasurement.port,
    mailboxRoot,
  }));
  registerHandlers(rpcHandlers, createDesktopRasterPdfDocumentRpcHandlers({
    port: electronPdfDocumentRuntime.raster,
    mailboxRoot,
  }));
  registerHandlers(rpcHandlers, createDesktopRendererIntegrationRpcHandlers(
    createElectronBackendRendererIntegrationPort(),
  ));
  registerHandlers(rpcHandlers, createExternalAuthorizationBrowserRpcHandlers(
    createElectronExternalAuthorizationBrowserPort(),
  ));
  registerHandlers(rpcHandlers, createDesktopWebPageRendererRpcHandlers({
    port: webPageRenderer,
    mailboxRoot,
  }));

  const process = createNodeAppServerProcessSupervisor({
    launch,
    rpcHandlers,
    stderrSink: input.backendStderrSink,
  });
  const commands = createCommandDesktopRpcGateways({
    rpc: process,
    onAsyncFailure: input.onAsyncFailure,
  });
  registerHandlers(rpcHandlers, commands.notificationHandlers);
  const rendererRequests = createBackendRendererRequestRpcGateway({
    rpc: process,
    mailboxRoot,
  });
  const activity = createAppServerActivityRpcGateway(process);
  let shutdownSettlement: Promise<void> | null = null;

  return Object.freeze({
    process,
    rendererRequests,
    commands,
    activity,
    start: () => process.start(),
    shutdown() {
      if (shutdownSettlement) return shutdownSettlement;
      shutdownSettlement = (async () => {
        const failures: unknown[] = [];
        try {
          await process.shutdown();
        } catch (error: unknown) {
          failures.push(error);
        }
        try {
          await webPageRenderer.dispose();
        } catch (error: unknown) {
          failures.push(error);
        }
        try {
          await textMeasurement.dispose();
        } catch (error: unknown) {
          failures.push(error);
        }
        if (failures.length > 0) throw failures[0];
      })();
      return shutdownSettlement;
    },
  });
}

function registerHandlers(
  target: Map<string, AppServerRpcHandler>,
  source: AppServerRpcHandlerRegistry,
): void {
  for (const [method, handler] of source) {
    if (target.has(method)) throw new Error(`Desktop App Server RPC method 重复注册: ${method}`);
    target.set(method, handler);
  }
}
