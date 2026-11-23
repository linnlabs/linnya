import { createScheduledTaskNotificationClient } from '../../desktop-capabilities/features/scheduled-task-notification-rpc';
import path from 'node:path';
import type { ScheduledTasks } from '../../application/scheduled-tasks';
import type { ConversationExecutionRuntimeCreateInput } from '../../application/conversation-runtime';
import {
  ConversationCommandPermissionRequestSchema,
  ConversationCommandPermissionResultSchema,
} from '@app/schemas/commands';
import { SqliteConversationCommandPermissions } from '../../adapters/persistence/conversation-command-permissions/sqliteConversationCommandPermissions';
import { SqliteUiProjectionApplier } from '../../adapters/persistence/event-store/ui-projection/sqliteApplier';
import {
  createConversationCommandPermissions,
  type ConversationCommandPermissions,
} from '../../application/conversation-command-permissions';
import { BACKEND_CONVERSATION_COMMAND_PERMISSION_RPC_METHOD } from '../../adapters/commands/renderer-rpc';

import type { AppServerRpcHandler, AppServerRpcPeer } from '../../app-server-rpc';
import type { AppServerBootstrap } from '../../app-server-bootstrap';
import type { HeadlessAppServerBackendComposition } from '../definitions/headlessAppServerBackendComposition';
import {
  createBackendRendererIntegrationRpcClient,
  createDesktopCapabilityMailboxRpcClient,
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
import { createStoredPluginCredentialRuntimePort } from '../../adapters/plugin-credentials/createStoredPluginCredentialRuntimePort';
import { createProfileCredentialStorage } from '../../adapters/credential-storage/createProfileCredentialStorage';
import { createExportArtifactCommitRpcClient } from '../../application/export-artifact-commit';
import { createInstalledRuntimeExecutableResolver } from '../functions/createInstalledRuntimeExecutableResolver';
import { resolveTrustedPluginCatalogKeys } from 'src/features/plugins/catalog/functions/resolvePluginCatalogSource';

/** 纯 Node App Server composition：这里创建唯一 Commands owner，并把 Desktop 能力收窄为 reverse RPC port。 */
export function createHeadlessAppServerBackendComposition(input: {
  readonly bootstrap: AppServerBootstrap;
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly mailboxRoot: string;
  readonly reportAsyncFailure: (error: Error) => void;
}): HeadlessAppServerBackendComposition {
  const credentialStorage = createProfileCredentialStorage(input.bootstrap.backend_facts.runtimePathRoots);
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
  let readScheduledTasks: (() => ScheduledTasks | undefined) | undefined;
  const commandApprovalHost = createCommandApprovalHost({
    deferApprovedReply: (conversationId, deliver) => readScheduledTasks?.()?.deferApproval(conversationId, deliver) ?? false,
  });
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

  const executionRuntimeFactory = createHeadlessNodeConversationExecutionRuntimeFactory({
    bootstrap: input.bootstrap.backend_facts,
    commandHostProcessEnvironment: input.bootstrap.command_host_environment,
    localProcessPlatformRuntime: input.bootstrap.local_process_platform_runtime,
    headlessNodeExecutablePath: input.bootstrap.headless_node_executable_path,
    commandPermissionSettings,
    commandApprovalHost,
    commandPresentationHost: commandCardControlHost,
  });
  let conversationPermissions: ConversationCommandPermissions | undefined;
  const backendRpcHandlers = new Map<string, AppServerRpcHandler>();
  if (input.bootstrap.host_kind === 'desktop') {
    backendRpcHandlers.set(BACKEND_CONVERSATION_COMMAND_PERMISSION_RPC_METHOD, async payload => {
      const request = ConversationCommandPermissionRequestSchema.parse(payload);
      return ConversationCommandPermissionResultSchema.parse(
        await conversationPermissions?.request(request) ?? { kind: 'error', code: 'unavailable' },
      );
    });
  }
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
      commandApprovalControl: commandApprovalHost,
      bootstrap: input.bootstrap.backend_facts,
      processRuntime: Object.freeze({
        qdrant: resolveQdrantProcessRuntime({
          packaged: input.bootstrap.backend_facts.packaged,
          resourcesPath: input.bootstrap.backend_facts.resourcesPath,
          mainBundleDirectory: input.bootstrap.backend_facts.mainBundleDirectory,
          platform: input.bootstrap.backend_facts.platform,
          architecture: input.bootstrap.backend_facts.architecture,
          hostEnvironment: input.bootstrap.command_host_environment.entries,
          resolveInstalledExecutable: createInstalledRuntimeExecutableResolver({
            runtimeId: 'qdrant',
            runtimeRoot: process.env.LINNYA_RUNTIME_ROOT,
            userPluginRoot: process.env.LINNYA_PLUGIN_ROOT,
            platform: input.bootstrap.backend_facts.platform,
            architecture: input.bootstrap.backend_facts.architecture,
            trustedKeys: resolveTrustedPluginCatalogKeys({
              identity: input.bootstrap.backend_facts.distributionIdentity,
              env: process.env,
            }),
          }),
        }),
        launchOwnedPipeProcess: createLocalProcessPlatformLauncher(
          input.bootstrap.local_process_platform_runtime,
        ),
        queueWorkers: resolveQueueWorkerRuntime(
          input.bootstrap.backend_facts.mainBundleDirectory,
        ),
      }),
      conversationExecutionRuntimeFactory: {
        async create(runtimeInput: ConversationExecutionRuntimeCreateInput) {
          const permissions = createConversationCommandPermissions({
            store: new SqliteConversationCommandPermissions(
              runtimeInput.db,
              fact => new SqliteUiProjectionApplier(runtimeInput.db).projectCommandPermissionChange(fact),
            ),
            globalSettings: commandPermissionSettings,
            readScheduledTasks: runtimeInput.readScheduledTasks,
            admission: runtimeInput.conversationAdmission,
            onFailure: error => input.reportAsyncFailure(toError(error)),
          });
          const scope = await executionRuntimeFactory.create(runtimeInput);
          conversationPermissions = permissions;
          readScheduledTasks = runtimeInput.readScheduledTasks;
          return Object.freeze({ ...scope, conversationPermissions: permissions,
            subscribeCommandApprovals: (listener: () => void) => commandApprovalHost.subscribe(listener),
            readConversationCommandPermission: permissions.readSelection });
        },
      },
      credentialStorage,
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
      ...(input.bootstrap.host_kind === 'desktop' ? { notifyScheduledTask: createScheduledTaskNotificationClient(input.rpc) } : {}),
      rasterPdfDocument: createDesktopRasterPdfDocumentRpcClient(mailbox),
      externalAuthorizationBrowser: createExternalAuthorizationBrowserRpcClient(input.rpc),
      webPageRenderer: createDesktopWebPageRendererRpcClient(mailbox),
    }),
    backendRpcHandlers,
    exportArtifactCommit: createExportArtifactCommitRpcClient(mailbox),
    fileReveal: createDesktopFileRevealRpcClient(input.rpc),
    pluginCredentialRuntime: createStoredPluginCredentialRuntimePort(credentialStorage),
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
