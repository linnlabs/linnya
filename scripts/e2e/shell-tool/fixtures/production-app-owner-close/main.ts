import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';
import {
  CommandAgentRunIdSchema,
  CommandControlToolCallIdSchema,
  CommandConversationIdSchema,
  CommandOriginToolCallIdSchema,
} from '@app/schemas/commands';
import {
  createCommandRunPermissionSnapshot,
} from '../../../../../src/domains/commands/features/permission-settings';

import { SQLiteEventStore } from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store';
import {
  createCommandApprovalHost,
} from '../../../../../src/app-hosts/linnya/adapters/commands/approval-host';
import {
  createElectronCommandProductionScope,
  resolveCommandRuntimeFacts,
} from '../../../../../src/electron-main/commands/production-runtime';
import { createConversationRouteLifecycle } from '../../../../../src/electron-main/routes/orchestration/createConversationRouteLifecycle';
import { DatabaseService } from '../../../../../src/electron-main/services/database';
import { runAppShutdownStages } from '../../../../../src/electron-main/app-lifecycle/runAppShutdownStages';
import { createAppShutdownLifecycle } from '../../../../../src/electron-main/app-lifecycle/orchestration/createAppShutdownLifecycle';
import {
  configureMainWindowCloseLifecycle,
  createWindow,
  permitMainWindowCloseForAppShutdown,
  prepareMainWindowForAppShutdown,
} from '../../../../../src/electron-main/window-manager.js';
import { bootstrapBuiltinPluginLifecycle } from '../../../../../src/app-hosts/linnya/plugin-registry/builtin';
import { createCollectingCommandExecutionAuditPort } from '../../functions/createCollectingCommandExecutionAuditPort';

function requireAbsoluteEnvironmentPath(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const runRoot = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_RUN_ROOT');
const resultPath = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_RESULT_PATH');
const handshakePath = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_HANDSHAKE_PATH');
const runnerRoot = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_RUNNER_ROOT');
const firstClosePath = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_FIRST_PATH');
const secondClosePath = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_SECOND_PATH');
const rendererReadyPath = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_RENDERER_READY_PATH');
const retryClosePath = requireAbsoluteEnvironmentPath('LINNYA_APP_CLOSE_RETRY_PATH');
const completeSlowSavePath = requireAbsoluteEnvironmentPath(
  'LINNYA_APP_CLOSE_COMPLETE_SLOW_SAVE_PATH',
);
const pipeCommand = requireEnvironment('LINNYA_APP_CLOSE_PIPE_COMMAND');
const ptyCommand = requireEnvironment('LINNYA_APP_CLOSE_PTY_COMMAND');
const eventLogPath = path.join(runRoot, 'events.log');
const conversationId = CommandConversationIdSchema.parse('conversation-production-app-close-e2e');
const pipeAgentRunId = CommandAgentRunIdSchema.parse('agent-run-production-app-close-pipe');
const ptyAgentRunId = CommandAgentRunIdSchema.parse('agent-run-production-app-close-pty');

app.setPath('userData', path.join(runRoot, 'electron-user-data'));
process.env.LINNYA_WORKSPACE_DIR = path.join(runRoot, 'workspace');

function appendEvent(event: string): void {
  fs.appendFileSync(eventLogPath, `${Date.now()}\t${process.pid}\t${event}\n`, 'utf8');
}

function publishJson(filePath: string, value: unknown): void {
  const pendingPath = `${filePath}.${process.pid}.pending`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify(value), 'utf8');
  fs.renameSync(pendingPath, filePath);
}

const permissionSettings = {
  schema_version: 1 as const,
  kind: 'command_permission_settings' as const,
  revision: 1,
  permission_level: 'standard' as const,
  internal_data_access: 'allowed' as const,
  gui_control: 'denied' as const,
  local_ipc_control: 'denied' as const,
  process_lifecycle: 'terminate_with_run' as const,
};

function commandPermission(agentRunId: typeof pipeAgentRunId) {
  return {
    status: 'available' as const,
    snapshot: createCommandRunPermissionSnapshot({
      settings: permissionSettings,
      rootAgentRunId: agentRunId,
      capturedAtMs: Date.now(),
    }),
  };
}

app.on('window-all-closed', () => undefined);

void app.whenReady().then(async () => {
  const appDataRoot = path.join(runRoot, 'app-data');
  fs.mkdirSync(appDataRoot, { recursive: true });
  const databaseService = new DatabaseService(path.join(runRoot, 'workspace.sqlite'));
  databaseService.initialize({ lifecycleBootstrap: bootstrapBuiltinPluginLifecycle });
  const db = databaseService.getDb();
  const eventStore = new SQLiteEventStore(db);
  const lifecycle = createConversationRouteLifecycle({
    db,
    eventStore,
    storageRoot: appDataRoot,
  });
  const commandScope = await createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost: createCommandApprovalHost(),
    commandExecutionAudit: createCollectingCommandExecutionAuditPort(),
    runtimeFacts: resolveCommandRuntimeFacts({
      platform: process.platform,
      environment: process.env,
      revision: 'production-app-close-e2e',
      platformRuntime: Object.freeze({ schema_version: 1, platform: 'darwin' }),
    }),
    helperEnvironment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    runnerPath: path.join(runnerRoot, 'commandRunnerUtilityProcess.cjs'),
    artifactStorageRoot: path.join(appDataRoot, 'ConversationArtifacts', 'v1'),
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(appDataRoot, 'ToolOutputBlobs', conversationId, instanceId)
    ),
  });
  // 正式 Agent 只会在持久对话内启动命令。先建立对话事实，既满足命令卡片终态的
  // 外键合同，也确保 App 关闭测试没有依赖生产中不可能出现的“孤儿命令”。
  await eventStore.ensureConversation(conversationId, [], undefined, 'agent');
  const directory = await lifecycle.workDirectoryAdmission.withAdmission(
    { conversationId },
    admitted => admitted,
  );
  const [pipeStarted, ptyStarted] = await Promise.all([
    commandScope.shellToolRuntime.executeShell({
      arguments: { command: pipeCommand, initial_wait_ms: 250 },
      conversationId,
      agentRunId: pipeAgentRunId,
      originToolCallId: CommandOriginToolCallIdSchema.parse('call-production-app-close-pipe'),
      toolOutputInstanceId: 'default',
      commandRunPermission: commandPermission(pipeAgentRunId),
    }),
    commandScope.shellToolRuntime.executeShell({
      arguments: { command: ptyCommand, interactive: true, initial_wait_ms: 250 },
      conversationId,
      agentRunId: ptyAgentRunId,
      originToolCallId: CommandOriginToolCallIdSchema.parse('call-production-app-close-pty'),
      toolOutputInstanceId: 'default',
      commandRunPermission: commandPermission(ptyAgentRunId),
    }),
  ]);
  assert.equal(pipeStarted.status, 'running');
  assert.equal(ptyStarted.status, 'running');
  if (pipeStarted.status !== 'running' || ptyStarted.status !== 'running') {
    throw new Error('pipe and PTY must both publish process handles before close validation');
  }
  assert.equal(commandScope.hasExecutingCommands(), true);

  let triggerPoll: NodeJS.Timeout | undefined;
  let decisionCount = 0;
  const shutdownLifecycle = createAppShutdownLifecycle({
    prepareAppShutdown: prepareMainWindowForAppShutdown,
    commitWindowClosePermission: permitMainWindowCloseForAppShutdown,
    requestElectronQuit() {
      app.quit();
    },
    async runShutdownStages() {
      if (triggerPoll) clearInterval(triggerPoll);
      appendEvent('will-quit-started');
      assert.equal(createWindow(), null, 'shutdown commit must reject a late activate/second-instance window');
      appendEvent('shutdown-window-gate-blocked');
      // 与正式 app-lifecycle 复用同一个 stage 编排；fixture 只省略本场景没有的网页 renderer owner。
      await runAppShutdownStages([() => commandScope.endOwnerAndWait()]);
      assert.equal(commandScope.hasExecutingCommands(), false);

      const [pipeHandleAfterExit, ptyHandleAfterExit] = await Promise.all([
        commandScope.shellToolRuntime.executeProcess({
          arguments: {
            process_handle: pipeStarted.processHandle,
            action: { type: 'poll', cursor: 0 },
          },
          conversationId,
          agentRunId: pipeAgentRunId,
          controlToolCallId: CommandControlToolCallIdSchema.parse(
            'call-production-app-close-pipe-after-exit',
          ),
          commandRunPermission: commandPermission(pipeAgentRunId),
        }),
        commandScope.shellToolRuntime.executeProcess({
          arguments: {
            process_handle: ptyStarted.processHandle,
            action: { type: 'poll', cursor: 0 },
          },
          conversationId,
          agentRunId: ptyAgentRunId,
          controlToolCallId: CommandControlToolCallIdSchema.parse(
            'call-production-app-close-pty-after-exit',
          ),
          commandRunPermission: commandPermission(ptyAgentRunId),
        }),
      ]);
      assert.equal(pipeHandleAfterExit.status, 'rejected');
      assert.equal(ptyHandleAfterExit.status, 'rejected');
      if (pipeHandleAfterExit.status !== 'rejected' || ptyHandleAfterExit.status !== 'rejected') {
        throw new Error('ended App owner must reject both old process handles');
      }
      assert.equal(pipeHandleAfterExit.code, 'owner_ended');
      assert.equal(ptyHandleAfterExit.code, 'owner_ended');
      publishJson(resultPath, {
        success: true,
        version: 1,
        platform: process.platform,
        architecture: process.arch,
        electron: process.versions.electron,
        decisionCount,
        shutdownWindowGateBlocked: true,
        pipeHandleAfterExit,
        ptyHandleAfterExit,
      });
      databaseService.close();
      appendEvent('will-quit-completed');
    },
    drainDiagnosticLog: async () => undefined,
    exitElectron: exitCode => app.exit(exitCode),
    updateHandoff: {
      isReady: () => false,
      handoff: () => {
        throw new Error('update handoff is outside this fixture');
      },
    },
  });
  configureMainWindowCloseLifecycle({
    hasExecutingCommands: () => commandScope.hasExecutingCommands(),
    requestExecutingCommandsDecision: async () => {
      decisionCount += 1;
      const decision = decisionCount === 1 ? 'return' : 'stop_and_close';
      appendEvent(`decision=${decision}`);
      return decision;
    },
    requestShutdown: () => shutdownLifecycle.requestOrdinaryExit(),
    isWindowClosePermitted: () => shutdownLifecycle.isWindowClosePermitted(),
    canAcceptWindowRequests: () => shutdownLifecycle.canAcceptWindowRequest(),
  });
  app.on('before-quit', (event) => {
    if (shutdownLifecycle.isWindowClosePermitted()) return;
    event.preventDefault();
    void shutdownLifecycle.requestOrdinaryExit().catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      publishJson(resultPath, { success: false, error: message });
      process.stderr.write(`LINNYA_APP_CLOSE_E2E_ERROR=${message}\n`);
    });
  });
  app.on('will-quit', (event) => {
    event.preventDefault();
    void shutdownLifecycle.completeCommittedShutdown().catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      publishJson(resultPath, { success: false, error: message });
      process.stderr.write(`LINNYA_APP_CLOSE_E2E_ERROR=${message}\n`);
      databaseService.close();
      app.exit(1);
    });
  });

  const mainWindow = createWindow();
  assert.ok(mainWindow, 'shutdown gate must allow the initial main window');
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    appendEvent(`preload-error=${preloadPath}:${error.stack ?? error.message}`);
  });
  mainWindow.on('page-title-updated', (_event, title) => {
    if (title.startsWith('renderer-')) appendEvent(title);
  });
  await new Promise<void>((resolve, reject) => {
    if (mainWindow.webContents.getURL() && !mainWindow.webContents.isLoading()) {
      resolve();
      return;
    }
    mainWindow.webContents.once('did-finish-load', () => resolve());
    mainWindow.webContents.once('did-fail-load', (_event, code, description) => {
      reject(new Error(`renderer failed to load: ${code} ${description}`));
    });
  });

  publishJson(handshakePath, {
    version: 1,
    workDirectory: directory.absolutePath,
    electronPid: process.pid,
  });
  appendEvent('ready');

  let firstTriggered = false;
  let secondTriggered = false;
  let rendererReadyTriggered = false;
  let retryTriggered = false;
  let preparingWindowGateChecked = false;
  let completeSlowSaveTriggered = false;
  triggerPoll = setInterval(() => {
    if (!firstTriggered && fs.existsSync(firstClosePath)) {
      firstTriggered = true;
      // 首次从菜单/Cmd+Q 等价入口退出，证明 before-quit 不会在用户返回前销毁 owner。
      app.quit();
      setImmediate(() => {
        appendEvent(`first-close-window-open=${!mainWindow.isDestroyed()}`);
      });
      return;
    }
    if (firstTriggered && !secondTriggered && fs.existsSync(secondClosePath)) {
      secondTriggered = true;
      mainWindow.close();
      setImmediate(() => {
        appendEvent(`second-close-waiting-renderer-ready=${!mainWindow.isDestroyed()}`);
      });
      return;
    }
    if (secondTriggered && !rendererReadyTriggered && fs.existsSync(rendererReadyPath)) {
      rendererReadyTriggered = true;
      void mainWindow.webContents.executeJavaScript(`JSON.stringify({
        fixture: typeof window.initializeCloseFixture,
        api: typeof window.electronAPI,
        listen: typeof window.electronAPI?.onWindowCloseRequest,
        ready: typeof window.electronAPI?.markWindowCloseRendererReady,
        complete: typeof window.electronAPI?.completeWindowClosePreparation,
      })`).then(diagnostics => {
        appendEvent(`renderer-api=${diagnostics}`);
        return mainWindow.webContents.executeJavaScript('window.initializeCloseFixture()');
      }).catch(error => {
        appendEvent(`renderer-initialize-error=${String(error)}`);
      });
      return;
    }
    if (rendererReadyTriggered && !retryTriggered && fs.existsSync(retryClosePath)) {
      retryTriggered = true;
      mainWindow.close();
      return;
    }
    if (
      retryTriggered
      && !preparingWindowGateChecked
      && mainWindow.getTitle() === 'renderer-slow-save-pending'
    ) {
      preparingWindowGateChecked = true;
      assert.equal(createWindow(), null, 'preparing exit must reject activate/second-instance windows');
      appendEvent('preparing-window-gate-blocked');
      return;
    }
    if (retryTriggered && !completeSlowSaveTriggered && fs.existsSync(completeSlowSavePath)) {
      completeSlowSaveTriggered = true;
      void mainWindow.webContents.executeJavaScript('window.completeSlowSave()').catch(error => {
        appendEvent(`renderer-complete-error=${String(error)}`);
      });
    }
  }, 20);
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  publishJson(resultPath, { success: false, error: message });
  process.stderr.write(`LINNYA_APP_CLOSE_E2E_ERROR=${message}\n`);
  app.exit(1);
});
