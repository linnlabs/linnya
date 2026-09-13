import path from 'node:path';

import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../app-server-rpc';
import { resolveBackendRendererRequestMailboxRoot } from '../../adapters/backend-renderer-requests/functions/backendRendererRequestMailbox';
import { createCommandApprovalHostPresenterRpcGateway } from '../../adapters/commands/host-presenter-rpc/orchestration/createCommandApprovalHostPresenterRpcGateway';
import { createDesktopCredentialProtectionRpcHandlers } from '../../desktop-capabilities/features/credential-protection-rpc/orchestration/createDesktopCredentialProtectionRpcHandlers';
import { createDesktopFileRevealRpcHandlers } from '../../desktop-capabilities/features/file-reveal-rpc/orchestration/createDesktopFileRevealRpcHandlers';
import { createDesktopHiddenWorkerHostRpcHandlers } from '../../desktop-capabilities/features/hidden-worker-host-rpc/orchestration/createDesktopHiddenWorkerHostRpcHandlers';
import { createDesktopRasterPdfDocumentRpcHandlers } from '../../desktop-capabilities/features/raster-pdf-document-rpc/orchestration/createDesktopRasterPdfDocumentRpcHandlers';
import { createDesktopRendererIntegrationRpcHandlers } from '../../desktop-capabilities/features/renderer-integration-rpc/orchestration/createDesktopRendererIntegrationRpcHandlers';
import { createDesktopTextMeasurementWorkerRpcHandlers } from '../../desktop-capabilities/features/text-measurement-worker-rpc/orchestration/createDesktopTextMeasurementWorkerRpcHandlers';
import { createDesktopWebPageRendererRpcHandlers } from '../../desktop-capabilities/features/web-page-renderer-rpc/orchestration/createDesktopWebPageRendererRpcHandlers';
import {
  createExternalAuthorizationBrowserRpcHandlers,
} from '../../application/provider-account-authorization/features/external-browser-rpc/orchestration/createExternalAuthorizationBrowserRpcHandlers';
import {
  createExportArtifactCommitRpcHandlers,
} from '../../application/export-artifact-commit/orchestration/createExportArtifactCommitRpcHandlers';
import { resolveAppServerBundleDirectory } from '../../app-server-runtime/functions/resolveAppServerBundleDirectory';
import { resolveAppServerProcessLaunch } from '../../app-server-runtime/orchestration/resolveAppServerProcessLaunch';
import { createBackendBootstrapFacts } from '../../backend-runtime/functions/createBackendBootstrapFacts';
import { resolveAppDefaultModelsPath } from '../../backend-runtime/functions/resolveAppDefaultModelsPath';
import { resolveBackendRuntimePathRoots } from '../../backend-runtime/functions/resolveBackendRuntimePathRoots';
import { createDesktopDiagnosticLogRpcHandlers } from '../../app-server-runtime/features/diagnostic-log-rpc/orchestration/createDesktopDiagnosticLogRpcHandlers';
import {
  createPluginCredentialRuntimeRpcHandlers,
} from '../../plugin-registry/features/credential-runtime-rpc';
import { createNodeAppServerProcessSupervisor } from '../../../../infra/adapters/app-server-process/orchestration/createNodeAppServerProcessSupervisor';
import { createHostProcessEnvironment } from '../../../../infra/adapters/command-runtime/environment/functions/createHostProcessEnvironment';
import { createSystemCredentialProtectionPort } from '../../../../infra/adapters/credential-protection/system-keyring';
import { createSourceDistributionIdentity } from '../../../../shared/distribution-identity/functions/createDistributionIdentity';
import { createFilePluginCredentialRuntimePort } from '../../../../plugin-sdk/backend/filePluginCredentialRuntime';
import type { CliAppServerRuntime, CliRuntimeHostInput } from '../definitions/cliRuntimeHost';
import {
  createCliRuntimeRendererIntegrationPort,
  createCliRuntimeUnavailableCapabilities,
  CliRuntimeCapabilityUnavailableError,
} from '../functions/createCliRuntimeHostCapabilities';
import { createCliRuntimeCommandApprovalPresenter } from './createCliRuntimeCommandApprovalPresenter';

export async function createCliAppServerRuntime(
  input: CliRuntimeHostInput,
): Promise<CliAppServerRuntime> {
  const runtimePathRoots = resolveBackendRuntimePathRoots({
    developmentRoot: input.developmentRoot,
    userDataDirectory: input.developmentRoot,
    documentsDirectory: input.developmentRoot,
    developmentMode: true,
    workspaceRootOverride: input.workspaceRootOverride,
  });
  const mainBundleDirectory = resolveAppServerBundleDirectory({
    packaged: false,
    resourcesPath: path.join(input.developmentRoot, 'extraResources'),
    developmentMainBundleDirectory: path.join(input.developmentRoot, 'dist', 'main'),
  });
  const defaultModels = resolveAppDefaultModelsPath({
    configuredPath: input.processEnvironment.MODEL_REGISTRY_DEFAULTS_PATH,
    applicationPath: input.developmentRoot,
    developmentRoot: input.developmentRoot,
    isPackaged: false,
  });
  const processEnvironment: NodeJS.ProcessEnv = {
    ...input.processEnvironment,
    LINNYA_DEV_MODE: 'true',
    LINNYA_PLUGIN_ROOT: input.processEnvironment.LINNYA_PLUGIN_ROOT
      ?? path.join(runtimePathRoots.appDataRoot, 'plugins'),
    MODEL_REGISTRY_DEFAULTS_PATH: defaultModels.path,
  };
  const commandHostEnvironment = createHostProcessEnvironment(input.processEnvironment);
  const backendFacts = createBackendBootstrapFacts({
    applicationVersion: input.applicationVersion,
    applicationExecutablePath: process.execPath,
    platform: process.platform,
    architecture: process.arch,
    packaged: false,
    distributionIdentity: createSourceDistributionIdentity(),
    resourcesPath: path.join(input.developmentRoot, 'extraResources'),
    mainBundleDirectory,
    runtimePathRoots,
    exposeProviderOutboundDebugRoutes: processEnvironment.NODE_ENV !== 'production',
  });
  const unavailable = createCliRuntimeUnavailableCapabilities();
  const mailboxRoot = resolveBackendRendererRequestMailboxRoot(runtimePathRoots.appDataRoot);
  const credentialProtection = createSystemCredentialProtectionPort({
    vaultId: runtimePathRoots.appDataRoot,
    allowMasterKeyCreation: false,
  });
  const pluginCredentialRuntime = await createFilePluginCredentialRuntimePort({
    filePath: path.join(runtimePathRoots.appDataRoot, 'config', 'plugin_credentials.json'),
    credentialProtection,
  });
  const rpcHandlers = new Map<string, AppServerRpcHandler>();
  registerHandlers(rpcHandlers, createDesktopDiagnosticLogRpcHandlers({
    writeRecord(record) { input.stderrSink.write(`${record.line}\n`); },
  }));
  registerHandlers(rpcHandlers, createDesktopCredentialProtectionRpcHandlers(
    credentialProtection,
  ));
  registerHandlers(rpcHandlers, createPluginCredentialRuntimeRpcHandlers(
    pluginCredentialRuntime,
  ));
  registerHandlers(rpcHandlers, createDesktopRendererIntegrationRpcHandlers(
    createCliRuntimeRendererIntegrationPort(),
  ));
  registerHandlers(rpcHandlers, createDesktopFileRevealRpcHandlers(unavailable.fileReveal));
  registerHandlers(rpcHandlers, createDesktopHiddenWorkerHostRpcHandlers({
    port: unavailable.hiddenWorker,
    mailboxRoot,
    assertDescriptorAllowed() {
      throw new CliRuntimeCapabilityUnavailableError('插件隐藏 Chromium worker');
    },
  }));
  registerHandlers(rpcHandlers, createDesktopTextMeasurementWorkerRpcHandlers({
    port: unavailable.textMeasurement,
    mailboxRoot,
  }));
  registerHandlers(rpcHandlers, createDesktopRasterPdfDocumentRpcHandlers({
    port: unavailable.rasterPdf,
    mailboxRoot,
  }));
  registerHandlers(rpcHandlers, createExternalAuthorizationBrowserRpcHandlers(
    unavailable.externalBrowser,
  ));
  registerHandlers(rpcHandlers, createDesktopWebPageRendererRpcHandlers({
    port: unavailable.webPageRenderer,
    mailboxRoot,
  }));
  registerHandlers(rpcHandlers, createExportArtifactCommitRpcHandlers({
    port: unavailable.exportArtifactCommit,
    mailboxRoot,
  }));

  const launch = await resolveAppServerProcessLaunch({
    hostKind: 'cli_runtime',
    backendConfiguration: {
      qdrant: { host: '127.0.0.1', port: input.qdrantPort },
      server: { port: input.apiPort },
    },
    backendFacts,
    commandHostEnvironment,
    processEnvironment,
    commandApprovalPresenter: { available: Boolean(input.commandApprovalPrompt) },
    textMeasurement: {
      useBrowserPretext: false,
      useHarfBuzz: true,
      availability: unavailable.textMeasurement.availability,
    },
  });
  const supervisor = createNodeAppServerProcessSupervisor({
    launch,
    rpcHandlers,
    stderrSink: input.stderrSink,
  });
  const approvals = createCommandApprovalHostPresenterRpcGateway({ rpc: supervisor });
  registerHandlers(rpcHandlers, approvals.notificationHandlers);
  const approvalPresenter = input.commandApprovalPrompt
    ? createCliRuntimeCommandApprovalPresenter({
        gateway: approvals.gateway,
        prompt: input.commandApprovalPrompt,
        reportFailure(error) {
          input.stderrSink.write(`[CLI Runtime] 命令审批终端失败: ${error.message}\n`);
        },
      })
    : null;
  let startSettlement: ReturnType<typeof supervisor.start> | null = null;
  let shutdownSettlement: Promise<void> | null = null;

  return Object.freeze({
    start() {
      if (!startSettlement) {
        startSettlement = (async () => {
          const identity = await supervisor.start();
          try {
            await approvalPresenter?.start();
          } catch (error: unknown) {
            await supervisor.shutdown().catch(() => undefined);
            throw error;
          }
          return identity;
        })();
      }
      return startSettlement;
    },
    async waitForExit() {
      const exit = await supervisor.waitForExit();
      approvalPresenter?.dispose();
      if (!exit.expected) {
        throw new Error(
          `App Server 意外退出：code=${String(exit.code)} signal=${String(exit.signal)}`,
        );
      }
    },
    shutdown() {
      if (!shutdownSettlement) {
        approvalPresenter?.dispose();
        shutdownSettlement = supervisor.shutdown();
      }
      return shutdownSettlement;
    },
  });
}

function registerHandlers(
  target: Map<string, AppServerRpcHandler>,
  source: AppServerRpcHandlerRegistry,
): void {
  for (const [method, handler] of source) {
    if (target.has(method)) throw new Error(`CLI Runtime RPC method 重复注册: ${method}`);
    target.set(method, handler);
  }
}
