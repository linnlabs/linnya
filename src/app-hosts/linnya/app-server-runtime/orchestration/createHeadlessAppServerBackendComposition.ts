import path from 'node:path';

import type { AppServerRpcHandler, AppServerRpcPeer } from '../../app-server-rpc';
import type { AppServerBootstrap } from '../../app-server-bootstrap';
import type { HeadlessAppServerBackendComposition } from '../definitions/headlessAppServerBackendComposition';
import {
  createBackendRendererIntegrationRpcClient,
  createDesktopCapabilityMailboxRpcClient,
  createDesktopCredentialProtectionRpcClient,
  createDesktopFileRevealRpcClient,
  createDesktopHiddenWorkerHostRpcClient,
  createDesktopRasterPdfDocumentRpcClient,
  createDesktopTextMeasurementWorkerRpcClient,
  createDesktopWebPageRendererRpcClient,
} from '../../desktop-capabilities';
import { createExternalAuthorizationBrowserRpcClient } from '../../application/provider-account-authorization';
import {
  createCommandApprovalHost,
} from '../../adapters/commands/approval-host';
import {
  createCommandCardControlHost,
} from '../../adapters/commands/command-card-control-host';
import {
  createCommandPermissionSettingsAuthority,
  createLocalCommandPermissionSettingsRendererGateway,
} from '../../adapters/commands/permission-settings-authority';
import {
  attachCommandRendererChangeRpcPublisher,
  createCommandBackendRpcHandlers,
} from '../../adapters/commands/renderer-rpc';
import {
  attachCommandApprovalHostPresenterPublisher,
  createCommandApprovalHostPresenterBackendRpcHandlers,
} from '../../adapters/commands/host-presenter-rpc';
import { createHeadlessNodeConversationExecutionRuntimeFactory } from '../../adapters/conversation-runtime/headless-node-runtime';
import { createLocalProcessPlatformLauncher } from '../../../../infra/adapters/local-process-runtime/production-runtime';
import { resolveQdrantProcessRuntime } from '../../../../infra/adapters/vector-store/qdrant';
import { resolveQueueWorkerRuntime } from '../../../../infra/task-queue/functions/resolveQueueWorkerRuntime';
import { createPluginCredentialRuntimeRpcClient } from '../../plugin-registry/features/credential-runtime-rpc';
import { createExportArtifactCommitRpcClient } from '../../application/export-artifact-commit';

/** 纯 Node App Server composition：这里创建唯一 Commands owner，并把 Desktop 能力收窄为 reverse RPC port。 */
export function createHeadlessAppServerBackendComposition(input: {
  readonly bootstrap: AppServerBootstrap;
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly mailboxRoot: string;
  readonly reportAsyncFailure: (error: Error) => void;
}): HeadlessAppServerBackendComposition {
  const mailbox = createDesktopCapabilityMailboxRpcClient({
    rpc: input.rpc,
    mailboxRoot: input.mailboxRoot,
  });
  const permissionSettingsPath = path.join(
    input.bootstrap.backend_facts.runtimePathRoots.appDataRoot,
    'config',
    'command_permission.json',
  );
  const commandPermissionSettings = createCommandPermissionSettingsAuthority({
    settingsPath: permissionSettingsPath,
    initializationMarkerPath: `${permissionSettingsPath}.initialized`,
  });
  const commandApprovalHost = createCommandApprovalHost();
  const commandApprovalPresenter = input.bootstrap.host_capabilities.command_approval_presenter;
  if (commandApprovalPresenter.available) {
    // CLI Runtime 的 API descriptor 会在 parent presenter 接上前出现；先在唯一
    // command owner 内启用 pipe-authenticated Host 通道，使最早的审批进入 pending。
    commandApprovalHost.enableHostPresenter();
  }
  const commandCardControlHost = createCommandCardControlHost({
    reportPersistenceFailure(context) {
      input.reportAsyncFailure(new Error(
        `命令卡片终态持久化失败: conversation=${context.conversationId} `
        + `process=${context.processHandle} cause=${toError(context.error).message}`,
      ));
    },
  });
  const rendererChangePublisher = input.bootstrap.host_kind === 'desktop'
    ? attachCommandRendererChangeRpcPublisher({
        rpc: input.rpc,
        approval: commandApprovalHost,
        card: commandCardControlHost,
        onFailure: input.reportAsyncFailure,
      })
    : null;
  const hostPresenterPublisher = commandApprovalPresenter.available
    ? attachCommandApprovalHostPresenterPublisher({
        rpc: input.rpc,
        approval: commandApprovalHost,
        onFailure: input.reportAsyncFailure,
      })
    : null;
  const rendererIntegration = createBackendRendererIntegrationRpcClient({
    rpc: input.rpc,
    onAsyncFailure: input.reportAsyncFailure,
  });

  const backendRpcHandlers = new Map<string, AppServerRpcHandler>();
  registerHandlers(backendRpcHandlers, createCommandBackendRpcHandlers({
    permissionSettings: createLocalCommandPermissionSettingsRendererGateway(
      commandPermissionSettings,
    ),
    approval: commandApprovalHost,
    card: commandCardControlHost,
  }));
  if (commandApprovalPresenter.available) {
    registerHandlers(
      backendRpcHandlers,
      createCommandApprovalHostPresenterBackendRpcHandlers(commandApprovalHost),
    );
  }

  return Object.freeze({
    backendHostDependencies: Object.freeze({
      bootstrap: input.bootstrap.backend_facts,
      processRuntime: Object.freeze({
        qdrant: resolveQdrantProcessRuntime({
          packaged: input.bootstrap.backend_facts.packaged,
          resourcesPath: input.bootstrap.backend_facts.resourcesPath,
          mainBundleDirectory: input.bootstrap.backend_facts.mainBundleDirectory,
          platform: input.bootstrap.backend_facts.platform,
          architecture: input.bootstrap.backend_facts.architecture,
          hostEnvironment: input.bootstrap.command_host_environment.entries,
        }),
        launchOwnedPipeProcess: createLocalProcessPlatformLauncher(
          input.bootstrap.local_process_platform_runtime,
        ),
        queueWorkers: resolveQueueWorkerRuntime(
          input.bootstrap.backend_facts.mainBundleDirectory,
        ),
      }),
      conversationExecutionRuntimeFactory:
        createHeadlessNodeConversationExecutionRuntimeFactory({
          bootstrap: input.bootstrap.backend_facts,
          commandHostProcessEnvironment: input.bootstrap.command_host_environment,
          localProcessPlatformRuntime: input.bootstrap.local_process_platform_runtime,
          headlessNodeExecutablePath: input.bootstrap.headless_node_executable_path,
          commandPermissionSettings,
          commandApprovalHost,
          commandPresentationHost: commandCardControlHost,
        }),
      credentialProtection: createDesktopCredentialProtectionRpcClient(input.rpc),
      hiddenWorkerHost: createDesktopHiddenWorkerHostRpcClient({
        rpc: input.rpc,
        mailbox,
        onAsyncFailure: input.reportAsyncFailure,
      }),
      textMeasurement: Object.freeze({
        worker: createDesktopTextMeasurementWorkerRpcClient({
          rpc: input.rpc,
          mailbox,
          availability: input.bootstrap.text_measurement.worker_availability,
          onAsyncFailure: input.reportAsyncFailure,
        }),
        useBrowserPretext: input.bootstrap.text_measurement.use_browser_pretext,
        useHarfBuzz: input.bootstrap.text_measurement.use_harfbuzz,
      }),
      rendererIntegration,
      rasterPdfDocument: createDesktopRasterPdfDocumentRpcClient(mailbox),
      externalAuthorizationBrowser: createExternalAuthorizationBrowserRpcClient(input.rpc),
      webPageRenderer: createDesktopWebPageRendererRpcClient(mailbox),
    }),
    backendRpcHandlers,
    exportArtifactCommit: createExportArtifactCommitRpcClient(mailbox),
    fileReveal: createDesktopFileRevealRpcClient(input.rpc),
    pluginCredentialRuntime: createPluginCredentialRuntimeRpcClient(input.rpc),
    dispose() {
      rendererChangePublisher?.dispose();
      hostPresenterPublisher?.dispose();
    },
  });
}

function registerHandlers(
  target: Map<string, AppServerRpcHandler>,
  source: ReadonlyMap<string, AppServerRpcHandler>,
): void {
  for (const [method, handler] of source) {
    if (target.has(method)) throw new Error(`Command Backend RPC method 重复注册: ${method}`);
    target.set(method, handler);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
