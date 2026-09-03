import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow } from 'electron';
import { resolveElectronLocalProcessPlatformRuntime } from '../../../../../src/electron-main/local-process-runtime/production-runtime';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandOriginToolCallIdSchema,
  CommandRunPermissionSnapshotV1Schema,
  type CommandAgentRunId,
  type CommandConversationId,
  type CommandOriginToolCallId,
  type ShellToolRuntimeResult,
} from '@app/schemas/commands';
import { SQLiteEventStore } from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store';
import { createEventStoreConversationFactsPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/conversation-facts';
import { SqliteConversationDirectoryCleanupJobPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/conversation-files';
import { createConversationLifecycleApplicationScope } from '../../../../../src/app-hosts/linnya/application/conversation-lifecycle';
import { createLocalConversationDirectoryPort } from '../../../../../src/infra/adapters/conversation-files/local-directory';
import { createCommandApprovalHost } from '../../../../../src/app-hosts/linnya/adapters/commands/approval-host';
import {
  createElectronCommandProductionScope,
  resolveCommandRuntimeFacts,
} from '../../../../../src/electron-main/commands/production-runtime';
import { registerCommandApprovalHandlers } from '../../../../../src/electron-main/ipc/handlers/commands/command-approval-ipc';
import { DatabaseService } from '../../../../../src/electron-main/services/database';
import { createCollectingCommandExecutionAuditPort } from '../../functions/createCollectingCommandExecutionAuditPort';

const DOM_WAIT_MS = 15_000;

interface ApprovalDomSnapshot {
  readonly command: string;
  readonly cwd: string;
  readonly reasons: readonly string[];
  readonly choices: readonly string[];
  readonly activeElementRole: string | null;
  readonly pageTicket: string;
  readonly approvalRequestId: string;
}

interface StartedShell {
  readonly result: Promise<ShellToolRuntimeResult>;
  isSettled(): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function listFilesRecursively(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else files.push(entryPath);
    }
  }
  try {
    await visit(root);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return files;
}

async function countArtifactsForToolCall(
  artifactRoot: string,
  originToolCallId: string,
): Promise<number> {
  let count = 0;
  for (const filePath of await listFilesRecursively(artifactRoot)) {
    if (path.basename(filePath) !== 'manifest.json') continue;
    const value: unknown = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    if (
      isRecord(value)
      && isRecord(value.owner)
      && isRecord(value.owner.identity)
      && value.owner.identity.origin_tool_call_id === originToolCallId
    ) {
      count += 1;
    }
  }
  return count;
}

async function waitFor<T>(
  description: string,
  read: () => Promise<T | undefined>,
  timeoutMs = DOM_WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch (error: unknown) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`等待${description}超时${suffix}`);
}

async function evaluateJson(window: BrowserWindow, source: string): Promise<unknown> {
  const raw: unknown = await window.webContents.executeJavaScript(
    `(async () => JSON.stringify(await (${source})))()`,
  );
  if (typeof raw !== 'string') throw new Error('renderer did not return serialized JSON');
  return JSON.parse(raw) as unknown;
}

function parseApprovalDomSnapshot(value: unknown): ApprovalDomSnapshot {
  if (
    !isRecord(value)
    || typeof value.command !== 'string'
    || typeof value.cwd !== 'string'
    || !Array.isArray(value.reasons)
    || !value.reasons.every(reason => typeof reason === 'string')
    || !Array.isArray(value.choices)
    || !value.choices.every(choice => typeof choice === 'string')
    || (value.activeElementRole !== null && typeof value.activeElementRole !== 'string')
    || typeof value.pageTicket !== 'string'
    || typeof value.approvalRequestId !== 'string'
  ) {
    throw new Error('renderer approval snapshot is invalid');
  }
  return {
    command: value.command,
    cwd: value.cwd,
    reasons: value.reasons,
    choices: value.choices,
    activeElementRole: value.activeElementRole,
    pageTicket: value.pageTicket,
    approvalRequestId: value.approvalRequestId,
  };
}

async function readApprovalDom(window: BrowserWindow): Promise<ApprovalDomSnapshot | undefined> {
  const value = await evaluateJson(window, `(() => {
    const panel = document.querySelector('.command-approval-panel');
    if (!(panel instanceof HTMLElement)) return null;
    const fixture = document.querySelector('[data-command-approval-fixture-ready=true]');
    if (!(fixture instanceof HTMLElement)) return null;
    const pageTicket = fixture.dataset.commandApprovalPageTicket;
    const approvalRequestId = fixture.dataset.commandApprovalRequestId;
    if (!pageTicket || !approvalRequestId) return null;
    return {
      command: panel.querySelector('.command-approval-command code')?.textContent ?? '',
      cwd: panel.querySelector('.command-approval-context > span:not(.command-approval-reason)')?.textContent ?? '',
      reasons: Array.from(panel.querySelectorAll('.command-approval-reason'))
        .map(element => element.textContent?.trim() ?? ''),
      choices: [
        ...Array.from(panel.querySelectorAll('[data-command-approval-choice]'))
          .map(element => element.getAttribute('data-command-approval-choice')),
        ...Array.from(panel.querySelectorAll('[data-command-approval-choice-available]'))
          .map(element => element.getAttribute('data-command-approval-choice-available')),
      ],
      activeElementRole: document.activeElement?.getAttribute('role') ?? null,
      pageTicket,
      approvalRequestId,
    };
  })()`);
  return value === null ? undefined : parseApprovalDomSnapshot(value);
}

async function waitForApprovalDom(window: BrowserWindow): Promise<ApprovalDomSnapshot> {
  return waitFor('真实审批 DOM', () => readApprovalDom(window));
}

async function clickApprovalChoice(
  window: BrowserWindow,
  choice: 'deny' | 'allow_once' | 'allow_for_conversation',
): Promise<void> {
  if (choice === 'allow_for_conversation') {
    const opened = await evaluateJson(window, `(() => {
      const trigger = document.querySelector(
        '[data-command-approval-choice-available="allow_for_conversation"] .select-trigger'
      );
      if (!(trigger instanceof HTMLButtonElement) || trigger.disabled) return false;
      trigger.click();
      return true;
    })()`);
    assert.equal(opened, true, 'conversation approval menu must open');
    await waitFor('本对话允许选项可点击', async () => {
      const clicked = await evaluateJson(window, `(() => {
        const button = document.querySelector('.command-approval-allow-for-conversation-option');
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`);
      return clicked === true ? true : undefined;
    });
    return;
  }
  const clicked = await evaluateJson(window, `(() => {
    const button = document.querySelector(
      '[data-command-approval-choice=${JSON.stringify(choice)}]'
    );
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `approval choice ${choice} must be clickable`);
}

async function waitForNoApprovalDom(window: BrowserWindow): Promise<void> {
  await waitFor('审批 DOM 消失', async () => {
    const absent = await evaluateJson(window, `!document.querySelector('.command-approval-panel')`);
    return absent === true ? true : undefined;
  });
}

function commandPermission(rootAgentRunId: CommandAgentRunId) {
  return {
    status: 'available' as const,
    snapshot: CommandRunPermissionSnapshotV1Schema.parse({
      protocol_version: 1,
      kind: 'command_run_permission_snapshot',
      root_agent_run_id: rootAgentRunId,
      settings_revision: 1,
      captured_at_ms: Date.now(),
      permission_level: 'standard',
      internal_data_access: 'allowed',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    }),
  };
}

function startDeleteCommand(input: {
  readonly commandScope: ReturnType<typeof createElectronCommandProductionScope>;
  readonly conversationId: CommandConversationId;
  readonly agentRunId: CommandAgentRunId;
  readonly originToolCallId: CommandOriginToolCallId;
  readonly markerName: string;
}): StartedShell {
  let settled = false;
  const result = input.commandScope.shellToolRuntime.executeShell({
    arguments: {
      command: `rm ${input.markerName}`,
      initial_wait_ms: 1_000,
    },
    conversationId: input.conversationId,
    agentRunId: input.agentRunId,
    originToolCallId: input.originToolCallId,
    toolOutputInstanceId: 'default',
    commandRunPermission: commandPermission(input.agentRunId),
  });
  void result.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  return { result, isSettled: () => settled };
}

async function resolveConversationRoot(
  lifecycle: ReturnType<typeof createConversationLifecycleApplicationScope>,
  conversationId: CommandConversationId,
): Promise<string> {
  let root: string | undefined;
  await lifecycle.workDirectoryAdmission.withAdmission(
    { conversationId },
    (directory) => { root = directory.absolutePath; },
  );
  if (!root) throw new Error('conversation directory admission did not publish a root');
  return root;
}

async function createMarker(
  lifecycle: ReturnType<typeof createConversationLifecycleApplicationScope>,
  conversationId: CommandConversationId,
  markerName: string,
): Promise<string> {
  const root = await resolveConversationRoot(lifecycle, conversationId);
  const markerPath = path.join(root, markerName);
  await fsp.writeFile(markerPath, 'must only be deleted after approval\n', 'utf8');
  return markerPath;
}

function assertCompleted(phase: string, result: ShellToolRuntimeResult): void {
  assert.equal(result.status, 'completed', `${phase}: ${JSON.stringify(result)}`);
}

export async function runProductionCommandApprovalDomScenario(input: {
  readonly runRoot: string;
  readonly rendererUrl: string;
  readonly preloadPath: string;
  readonly runnerPath: string;
}): Promise<Record<string, unknown>> {
  if (process.platform !== 'darwin') {
    throw new Error('production command approval DOM E2E currently targets macOS');
  }

  const appDataRoot = path.join(input.runRoot, 'app-data');
  const artifactRoot = path.join(appDataRoot, 'ConversationArtifacts', 'v1');
  const databasePath = path.join(input.runRoot, 'workspace.sqlite');
  await fsp.mkdir(appDataRoot, { recursive: true });
  const databaseService = new DatabaseService(databasePath);
  databaseService.initialize();
  const db = databaseService.getDb();
  const seededAt = Date.now();
  const seedConversation = db.prepare<[string, string, number, number]>(`
    INSERT INTO conversations (conversation_id, title, created_at, last_event_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const conversationId of [
    'approval-dom-deny',
    'approval-dom-once',
    'approval-dom-remembered',
    'approval-dom-reload',
  ]) {
    seedConversation.run(conversationId, `Approval DOM ${conversationId}`, seededAt, seededAt);
  }
  const eventStore = new SQLiteEventStore(db);
  const lifecycle = createConversationLifecycleApplicationScope({
    cleanupJobs: new SqliteConversationDirectoryCleanupJobPort(db),
    directories: createLocalConversationDirectoryPort({ storageRoot: appDataRoot }),
    facts: createEventStoreConversationFactsPort(eventStore),
  });
  const approvalHost = createCommandApprovalHost();
  registerCommandApprovalHandlers({ host: approvalHost });
  const commandScope = createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost,
    commandExecutionAudit: createCollectingCommandExecutionAuditPort(),
    runtimeFacts: resolveCommandRuntimeFacts({
      platform: process.platform,
      environment: process.env,
      revision: randomUUID(),
      platformRuntime: resolveElectronLocalProcessPlatformRuntime({
        platform: process.platform,
        architecture: process.arch,
        applicationVersion: app.getVersion(),
        applicationExecutablePath: process.execPath,
        resourcesPath: process.resourcesPath,
        packaged: false,
        hostEnvironment: {},
      }),
    }),
    helperEnvironment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    runnerPath: input.runnerPath,
    artifactStorageRoot: artifactRoot,
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(appDataRoot, 'ToolOutputBlobs', conversationId, instanceId)
    ),
  });
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    process.stderr.write(
      `LINNYA_COMMAND_APPROVAL_DOM_LOAD_FAILED=${JSON.stringify({
        errorCode,
        errorDescription,
        validatedUrl,
      })}\n`,
    );
  });
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      process.stderr.write(
        `LINNYA_COMMAND_APPROVAL_DOM_RENDERER_CONSOLE=${JSON.stringify(details)}\n`,
      );
    }
  });

  try {
    await window.loadURL(`${input.rendererUrl}?fixture=command-approval-dom`);
    await waitFor('审批 fixture 挂载', async () => {
      const ready = await evaluateJson(
        window,
        `document.querySelector('[data-command-approval-fixture-ready=true]') !== null`,
      );
      return ready === true ? true : undefined;
    });
    // request() 只在 renderer 页面先向 main 取得 page ticket 后才接受审批，
    // 这里从真实 store 观察 ready，避免用延时掩盖启动时序。
    await waitFor('审批页面在 main 注册', async () => {
      const state = await evaluateJson(window, `document
        .querySelector('[data-command-approval-fixture-ready=true]')
        ?.getAttribute('data-command-approval-page-state')`);
      return state === 'ready' ? true : undefined;
    });

    const denyConversation = CommandConversationIdSchema.parse('approval-dom-deny');
    const denyRun = CommandAgentRunIdSchema.parse('approval-dom-deny-run');
    const denyToolCall = CommandOriginToolCallIdSchema.parse('approval-dom-deny-call');
    const denyMarkerName = 'deny-marker.txt';
    const denyMarkerPath = await createMarker(lifecycle, denyConversation, denyMarkerName);
    const denied = startDeleteCommand({
      commandScope,
      conversationId: denyConversation,
      agentRunId: denyRun,
      originToolCallId: denyToolCall,
      markerName: denyMarkerName,
    });
    const denyDom = await waitForApprovalDom(window);
    assert.equal(denyDom.command, `rm ${denyMarkerName}`);
    assert.equal(denyDom.cwd, path.dirname(denyMarkerPath));
    assert(denyDom.reasons.some(reason => reason.includes('删除')));
    assert.deepEqual(
      new Set(denyDom.choices),
      new Set(['deny', 'allow_for_conversation', 'allow_once']),
    );
    assert.equal(denyDom.activeElementRole, null);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
    await window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    assert.equal(denied.isSettled(), false, 'dialog-level Enter must not approve or deny');
    assert.equal(await pathExists(denyMarkerPath), true);
    await clickApprovalChoice(window, 'deny');
    const deniedResult = await denied.result;
    assert.equal(deniedResult.status, 'rejected');
    if (deniedResult.status !== 'rejected') throw new Error('deny must reject the shell call');
    assert.equal(deniedResult.code, 'approval_denied');
    assert.equal(await pathExists(denyMarkerPath), true);
    assert.equal(await countArtifactsForToolCall(artifactRoot, denyToolCall), 0);
    assert.equal(commandScope.hasExecutingCommands(), false);
    await waitForNoApprovalDom(window);

    const onceConversation = CommandConversationIdSchema.parse('approval-dom-once');
    const onceMarkerName = 'once-marker.txt';
    const onceMarkerPath = await createMarker(lifecycle, onceConversation, onceMarkerName);
    const firstOnce = startDeleteCommand({
      commandScope,
      conversationId: onceConversation,
      agentRunId: CommandAgentRunIdSchema.parse('approval-dom-once-run-1'),
      originToolCallId: CommandOriginToolCallIdSchema.parse('approval-dom-once-call-1'),
      markerName: onceMarkerName,
    });
    await waitForApprovalDom(window);
    await clickApprovalChoice(window, 'allow_once');
    assertCompleted('allow_once:first', await firstOnce.result);
    assert.equal(await pathExists(onceMarkerPath), false);
    const onceApprovalCount = db.prepare<[CommandConversationId], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM conversation_command_approvals
      WHERE conversation_id = ?
    `).get(onceConversation);
    if (!onceApprovalCount) throw new Error('allow-once approval count is unavailable');
    assert.equal(onceApprovalCount.count, 0);
    await waitForNoApprovalDom(window);
    await fsp.writeFile(onceMarkerPath, 'second allow-once request\n', 'utf8');
    const secondOnce = startDeleteCommand({
      commandScope,
      conversationId: onceConversation,
      agentRunId: CommandAgentRunIdSchema.parse('approval-dom-once-run-2'),
      originToolCallId: CommandOriginToolCallIdSchema.parse('approval-dom-once-call-2'),
      markerName: onceMarkerName,
    });
    await waitForApprovalDom(window);
    assert.equal(secondOnce.isSettled(), false, 'allow_once must not authorize the next command');
    await clickApprovalChoice(window, 'deny');
    const secondOnceResult = await secondOnce.result;
    assert.equal(secondOnceResult.status, 'rejected');
    assert.equal(await pathExists(onceMarkerPath), true);
    await waitForNoApprovalDom(window);

    const rememberedConversation = CommandConversationIdSchema.parse('approval-dom-remembered');
    const rememberedMarkerName = 'remembered-marker.txt';
    const rememberedMarkerPath = await createMarker(
      lifecycle,
      rememberedConversation,
      rememberedMarkerName,
    );
    const firstRemembered = startDeleteCommand({
      commandScope,
      conversationId: rememberedConversation,
      agentRunId: CommandAgentRunIdSchema.parse('approval-dom-remembered-run-1'),
      originToolCallId: CommandOriginToolCallIdSchema.parse('approval-dom-remembered-call-1'),
      markerName: rememberedMarkerName,
    });
    await waitForApprovalDom(window);
    await clickApprovalChoice(window, 'allow_for_conversation');
    assertCompleted('allow_for_conversation:first', await firstRemembered.result);
    assert.equal(await pathExists(rememberedMarkerPath), false);
    const rememberedRows = db.prepare<[
      CommandConversationId,
    ], {
      token_prefix_json: string;
      approved_cwd: string;
    }>(`
      SELECT token_prefix_json, approved_cwd
      FROM conversation_command_approvals
      WHERE conversation_id = ?
      ORDER BY approved_at_ms, approval_request_id
    `).all(rememberedConversation);
    assert.equal(rememberedRows.length, 1);
    assert.deepEqual(JSON.parse(rememberedRows[0]?.token_prefix_json ?? 'null'), [
      'rm',
      rememberedMarkerName,
    ]);
    assert.equal(rememberedRows[0]?.approved_cwd, path.dirname(rememberedMarkerPath));
    await waitForNoApprovalDom(window);
    await fsp.writeFile(rememberedMarkerPath, 'remembered request\n', 'utf8');
    await window.webContents.executeJavaScript(`(() => {
      window.__LINNYA_APPROVAL_OVERLAY_APPEARANCES__ = 0;
      window.__LINNYA_APPROVAL_OVERLAY_OBSERVER__?.disconnect();
      const observer = new MutationObserver((records) => {
        const approvalAdded = records.some(record => Array.from(record.addedNodes).some(node => (
          node instanceof Element
          && (node.matches('.command-approval-dialog')
            || node.querySelector('.command-approval-dialog'))
        )));
        if (approvalAdded) {
          window.__LINNYA_APPROVAL_OVERLAY_APPEARANCES__ += 1;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.__LINNYA_APPROVAL_OVERLAY_OBSERVER__ = observer;
    })()`);
    const secondRemembered = startDeleteCommand({
      commandScope,
      conversationId: rememberedConversation,
      agentRunId: CommandAgentRunIdSchema.parse('approval-dom-remembered-run-2'),
      originToolCallId: CommandOriginToolCallIdSchema.parse('approval-dom-remembered-call-2'),
      markerName: rememberedMarkerName,
    });
    assertCompleted('allow_for_conversation:remembered', await secondRemembered.result);
    assert.equal(await pathExists(rememberedMarkerPath), false);
    const overlayAppearances = await evaluateJson(window, `(() => {
      window.__LINNYA_APPROVAL_OVERLAY_OBSERVER__?.disconnect();
      return window.__LINNYA_APPROVAL_OVERLAY_APPEARANCES__;
    })()`);
    assert.equal(overlayAppearances, 0, 'remembered command must not open approval DOM');
    const rememberedCount = db.prepare<[CommandConversationId], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM conversation_command_approvals
      WHERE conversation_id = ?
    `).get(rememberedConversation);
    if (!rememberedCount) throw new Error('remembered approval count is unavailable');
    assert.equal(rememberedCount.count, 1);

    const reloadConversation = CommandConversationIdSchema.parse('approval-dom-reload');
    const reloadRun = CommandAgentRunIdSchema.parse('approval-dom-reload-run');
    const reloadToolCall = CommandOriginToolCallIdSchema.parse('approval-dom-reload-call');
    const reloadMarkerName = 'reload-marker.txt';
    const reloadMarkerPath = await createMarker(lifecycle, reloadConversation, reloadMarkerName);
    const reloaded = startDeleteCommand({
      commandScope,
      conversationId: reloadConversation,
      agentRunId: reloadRun,
      originToolCallId: reloadToolCall,
      markerName: reloadMarkerName,
    });
    const oldPage = await waitForApprovalDom(window);
    const didFinishLoad = new Promise<void>(resolve => {
      window.webContents.once('did-finish-load', () => resolve());
    });
    window.webContents.reload();
    await didFinishLoad;
    const newPage = await waitForApprovalDom(window);
    assert.notEqual(newPage.pageTicket, oldPage.pageTicket);
    assert.equal(newPage.approvalRequestId, oldPage.approvalRequestId);
    const oldTicketReply = await evaluateJson(window, `window.electronAPI.replyToCommandApproval({
      protocol_version: 1,
      kind: 'command_approval_reply_submission',
      page_ticket: ${JSON.stringify(oldPage.pageTicket)},
      approval_request_id: ${JSON.stringify(oldPage.approvalRequestId)},
      choice: 'allow_once',
    })`);
    assert.deepEqual(oldTicketReply, { success: true, status: 'invalid_page' });
    assert.equal(reloaded.isSettled(), false);
    assert.equal(await pathExists(reloadMarkerPath), true);
    assert.equal((await readApprovalDom(window))?.approvalRequestId, oldPage.approvalRequestId);
    await clickApprovalChoice(window, 'allow_once');
    assertCompleted('reload:current_ticket', await reloaded.result);
    assert.equal(await pathExists(reloadMarkerPath), false);
    assert.equal(await countArtifactsForToolCall(artifactRoot, reloadToolCall), 1);
    assert.equal(commandScope.hasExecutingCommands(), false);
    await waitForNoApprovalDom(window);

    return {
      success: true,
      version: 1,
      renderer: 'real-vue-dom',
      preload: 'production-command-runtime-preload',
      deny: {
        status: deniedResult.status,
        code: deniedResult.code,
        markerPreserved: true,
        artifactCount: 0,
      },
      allowOnce: {
        firstExecuted: true,
        secondRequestedApproval: true,
        rememberedRows: 0,
      },
      allowForConversation: {
        firstExecuted: true,
        secondExecutedWithoutDialog: true,
        rememberedRows: rememberedCount.count,
      },
      reload: {
        oldTicketStatus: 'invalid_page',
        pendingRequestPreserved: true,
        executedWithCurrentTicket: true,
      },
    };
  } finally {
    await commandScope.endOwnerAndWait();
    if (!window.isDestroyed()) window.destroy();
    databaseService.close();
  }
}
