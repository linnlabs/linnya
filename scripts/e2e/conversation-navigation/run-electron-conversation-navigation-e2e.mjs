import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runSidePaneDraftAssembly,
} from './side-pane-draft-scenario.mjs';
import {
  runProjectionSettlementReplay,
} from './projection-settlement-scenario.mjs';
import {
  isSameMacosProcessInstanceAlive,
  readMacosDescendantInstances,
  readMacosLaunchServicesApplicationRecords,
} from '../shell-tool/harness/macosElectronProcessObservation.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tempRoot = join(os.tmpdir(), `linnya-conversation-navigation-e2e-${process.pid}`);
const workspaceRoot = join(tempRoot, 'workspace-root');
const userDataRoot = join(tempRoot, 'electron-profile');
const pluginRoot = join(tempRoot, 'plugins');
const databasePath = join(workspaceRoot, 'workspace', 'workspace.sqlite');
const sourceDatabasePath = process.env.LINNYA_CONVERSATION_E2E_SOURCE_DB?.trim() || null;
const scenario = process.env.LINNYA_CONVERSATION_E2E_SCENARIO?.trim() || 'navigation';
const seededTurnCount = [
  'side-pane-draft',
  'subrun-reload',
  'projection-settlement',
  'resource-link',
].includes(scenario) ? 1 : 24;
const resourceLinkConversationId = 'e2e-conversation-a';
const resourceLinkWorkspaceDocumentId = '2f86c591-99de-4ec1-bc75-118167b76bd8';
const resourceLinkWorkspaceTitle = 'E2E 真实标题.md';
const resourceLinkConversationLocator = 'conversation:/renders/预览图.png';
const resourceLinkHostFile = join(tempRoot, '外部报告.pdf');
const subrunPreviewAssetId = 'e2e-subrun-preview-asset';
const subrunPreviewAttachmentId = 'e2e-subrun-preview-attachment';
const subrunPreviewBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGOQL9/yHwAETQJKE0On6gAAAABJRU5ErkJggg==',
  'base64',
);

const wait = (ms) => new Promise(resolveWait => setTimeout(resolveWait, ms));

function canListenOnPort(port) {
  return new Promise((resolveCheck) => {
    const server = net.createServer();
    server.once('error', () => resolveCheck(false));
    server.once('listening', () => server.close(() => resolveCheck(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(candidates) {
  for (const port of candidates) {
    if (await canListenOnPort(port)) return port;
  }
  throw new Error(`没有可用端口: ${candidates.join(', ')}`);
}

function spawnLogged(command, args, options) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => {
    options.observeOutput?.(chunk.toString());
    process.stdout.write(`[${options.label}] ${chunk}`);
  });
  child.stderr.on('data', chunk => {
    options.observeOutput?.(chunk.toString());
    process.stderr.write(`[${options.label}] ${chunk}`);
  });
  return child;
}

function terminateProcessTree(child, signal) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.off('exit', handleExit);
      resolveExit(false);
    }, timeoutMs);
    const handleExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once('exit', handleExit);
  });
}

async function stopProcessTree(child, gracefulSignal) {
  terminateProcessTree(child, gracefulSignal);
  if (await waitForProcessExit(child, 2000)) return;
  terminateProcessTree(child, 'SIGKILL');
  await waitForProcessExit(child, 5000);
}

async function observeMacosAppServerIdentity(electronRootPid) {
  if (process.platform !== 'darwin') return null;
  const descendants = await readMacosDescendantInstances(electronRootPid);
  const appServer = descendants.find(instance => (
    instance.command.includes('app-server-entry.cjs')
  ));
  assert(appServer, 'App Server 必须是 Electron App 的后代');
  assert(
    appServer.command.includes(`/extraResources/headless-node-runtime/darwin/${process.arch}/bin/node`),
    `App Server 必须使用固定 headless Node，实际命令: ${appServer.command}`,
  );

  const launchServices = await readMacosLaunchServicesApplicationRecords();
  const observedPids = new Set([electronRootPid, ...descendants.map(instance => instance.pid)]);
  const foreground = [...launchServices.values()].filter(record => (
    observedPids.has(record.pid) && record.type === 'Foreground'
  ));
  assert.equal(foreground.length, 1, 'Linnya 进程树必须只有一个 Foreground App identity');
  assert.equal(
    launchServices.has(appServer.pid),
    false,
    '固定 headless Node App Server 不得注册 LaunchServices App identity',
  );
  return Object.freeze({ appServer, descendants });
}

async function waitForObservedDescendantsExit(instances, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let survivors = instances;
  do {
    survivors = [];
    for (const instance of instances) {
      if (await isSameMacosProcessInstanceAlive(instance)) survivors.push(instance);
    }
    if (survivors.length === 0) return survivors;
    await wait(50);
  } while (Date.now() < deadline);
  return survivors;
}

function getHttpJson(port, path) {
  return new Promise((resolveJson, rejectJson) => {
    const request = http.get({ host: '127.0.0.1', port, path }, (response) => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          resolveJson(JSON.parse(body));
        } catch (error) {
          rejectJson(error);
        }
      });
    });
    request.once('error', rejectJson);
    request.setTimeout(2000, () => request.destroy(new Error(`${path} 请求超时`)));
  });
}

async function waitFor(check, description, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`等待${description}超时${lastError ? `: ${lastError.message}` : ''}`);
}

async function connectCdp(webSocketUrl) {
  const socket = new globalThis.WebSocket(webSocketUrl);
  const pending = new Map();
  const eventListeners = new Set();
  let nextMessageId = 1;

  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error('CDP 连接超时')), 5000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolveOpen();
    });
    socket.addEventListener('error', rejectOpen);
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      for (const listener of eventListeners) listener(message);
      return;
    }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });

  return {
    send(method, params = {}, timeoutMs = 10_000) {
      const id = nextMessageId;
      nextMessageId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveSend, rejectSend) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectSend(new Error(`${method} 超时`));
        }, timeoutMs);
        pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

function openNodeDatabase(options = {}) {
  return new Database(databasePath, options);
}

function resolveConversationWorkDirectory(conversationId) {
  const digest = createHash('sha256').update(conversationId, 'utf8').digest('hex');
  return join(
    userDataRoot,
    'AIService',
    'ConversationWorkDirectories',
    'v1',
    'workspaces',
    `conversation_${digest}`,
  );
}

function resourceLinkAnswer(title) {
  const hostLocator = pathToFileURL(resourceLinkHostFile).href;
  return [
    `${title} 回答 1`,
    '',
    `[模型写错的标题](workspace:/${resourceLinkWorkspaceTitle})`,
    `[生成预览](${resourceLinkConversationLocator})`,
    `[外部报告](<${hostLocator}>)`,
  ].join('\n');
}

function seedConversations(projectId) {
  const db = openNodeDatabase();
  db.pragma('busy_timeout = 5000');
  const seed = db.transaction(() => {
    const now = Date.now();
    const subrunPreview = (() => {
      if (scenario !== 'subrun-reload') return null;
      const binding = db.prepare(`
        SELECT storage_id
        FROM asset_storage_bindings
        WHERE storage_kind = 'managed_image_v2'
      `).get();
      if (!binding?.storage_id) {
        throw new Error('Subrun 图片重载 fixture 缺少 managed image store binding');
      }
      const sha256 = createHash('sha256').update(subrunPreviewBytes).digest('hex');
      const relativeResourcePath = `${sha256.slice(0, 2)}/${sha256}.png`;
      const localPath = join(
        userDataRoot,
        'AIService',
        'ConversationAttachments',
        'v2',
        'stores',
        binding.storage_id,
        'content',
        relativeResourcePath,
      );
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, subrunPreviewBytes);
      db.prepare(`
        INSERT INTO assets (
          id, uri, media_type, size_bytes, width_px, height_px,
          sha256, storage_status, local_path, created_at
        ) VALUES (?, ?, 'image/png', ?, 1, 1, ?, 'local', ?, ?)
      `).run(
        subrunPreviewAssetId,
        `/Resources/Attachments/${relativeResourcePath}`,
        subrunPreviewBytes.byteLength,
        sha256,
        localPath,
        now,
      );
      return {
        id: subrunPreviewAttachmentId,
        kind: 'image',
        resourceId: subrunPreviewAssetId,
        mediaType: 'image/png',
        byteLength: subrunPreviewBytes.byteLength,
        width: 1,
        height: 1,
        sha256,
        fileName: 'slide-001.png',
      };
    })();
    // Subrun 重载场景只缩小无关的父时间线；trace 仍经真实 SQLite/API/Renderer 全链路读取。
    // 这避免把 Subrun 协议门禁绑定到通用导航场景的长列表滚动时序。
    const insertConversation = db.prepare(`
      INSERT INTO conversations (
        conversation_id, title, created_at, last_event_at, preview_text,
        total_events, user_message_count, project_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertProjection = db.prepare(`
      INSERT INTO conversation_ui_projection_state (
        conversation_id, status, revision, last_event_rowid, rebuilt_at
      ) VALUES (?, 'ready', 1, 0, ?)
    `);
    const insertMessage = db.prepare(`
      INSERT INTO conversation_ui_messages (
        message_id, conversation_id, turn_id, role, message_type,
        sort_seq, timestamp, content, attachments_json, payload_json,
        merge_key, presentation, run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)
    `);
    const insertSubrunTraceRun = db.prepare(`
      INSERT INTO subrun_trace_runs (
        subrun_id, conversation_id, turn_id, parent_run_id,
        parent_tool_call_id, subrun_parent_id, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)
    `);
    const insertSubrunTraceItem = db.prepare(`
      INSERT INTO subrun_trace_items (
        subrun_id, source_event_id, kind, timestamp, payload_json
      ) VALUES (?, ?, ?, ?, ?)
    `);

    if (scenario === 'resource-link') {
      db.prepare(`
        INSERT INTO workspace_nodes (
          id, project_id, parent_id, type, name, icon, created_at, updated_at,
          deleted_at, last_opened_at, access_count, tags
        ) VALUES (?, ?, NULL, 'document', ?, NULL, ?, ?, NULL, NULL, 0, NULL)
      `).run(resourceLinkWorkspaceDocumentId, projectId, resourceLinkWorkspaceTitle, now, now);
      db.prepare(`
        INSERT INTO document_versions (
          id, node_id, version_number, content_json, char_count, created_at, author_id
        ) VALUES (?, ?, 1, ?, ?, ?, 'e2e')
      `).run(
        'e2e-resource-link-document-version',
        resourceLinkWorkspaceDocumentId,
        JSON.stringify({
          type: 'doc',
          content: [{
            type: 'rootBlock',
            attrs: { id: 'e2e-resource-link-root' },
            content: [{
              type: 'baseBlock',
              attrs: { id: 'e2e-resource-link-base', blockType: 'base' },
              content: [{ type: 'text', text: '资源链接跳转成功' }],
            }],
          }],
        }),
        8,
        now,
      );
    }

    for (const [conversationIndex, conversationId] of ['e2e-conversation-a', 'e2e-conversation-b'].entries()) {
      const title = conversationIndex === 0 ? 'E2E 对话 A' : 'E2E 对话 B';
      insertConversation.run(
        conversationId,
        title,
        now - conversationIndex,
        now - conversationIndex,
        title,
        seededTurnCount * 2 + (conversationIndex === 0 && scenario !== 'resource-link' ? 2 : 0),
        seededTurnCount,
        projectId,
      );
      insertProjection.run(conversationId, now);
      for (let turn = 1; turn <= seededTurnCount; turn += 1) {
        const userSeq = turn * 2 - 1;
        const answerSeq = conversationIndex === 0 && turn === 24 ? 49 : turn * 2;
        const turnId = `${conversationId}-turn-${turn}`;
        const runId = `${conversationId}-run-${turn}`;
        insertMessage.run(
          `${conversationId}-user-${turn}`,
          conversationId,
          turnId,
          'user',
          'user_input',
          userSeq,
          now + userSeq,
          `${title} 用户消息 ${turn}`,
          null,
          runId,
        );
        insertMessage.run(
          `${conversationId}-answer-${turn}`,
          conversationId,
          turnId,
          'assistant',
          'final_answer',
          answerSeq,
          now + answerSeq,
          scenario === 'resource-link' && conversationIndex === 0 && turn === 1
            ? resourceLinkAnswer(title)
            : `${title} 回答 ${turn}\n\n\`\`\`ts\nconst turn = ${turn};\n\`\`\``,
          JSON.stringify({
            answer_id: `${conversationId}-answer-${turn}`,
            is_complete: true,
            completion_reason: 'terminal',
            first_token_at: now + answerSeq,
          }),
          runId,
        );
      }

      if (conversationIndex === 0 && scenario !== 'resource-link') {
        const readFileResult = {
          data: {
            source_kind: 'workspace_document',
            locator: 'workspace:/e2e-workspace-document.md',
            inode: 'workspace:e2e-workspace-document',
            content_type: 'application/vnd.linnya.document-view',
            document: {
              documentId: 'e2e-workspace-document',
              docType: 'markdown',
              documentName: 'E2E Workspace 文档',
              truncatedByChars: false,
              totalTextLength: 18,
              presentation: {
                kind: 'text',
                text: 'read_file 正式结果',
              },
              nextOffset: null,
            },
          },
          observation: 'read_file 正式结果',
        };
        insertMessage.run(
          `${conversationId}-read-file`,
          conversationId,
          `${conversationId}-turn-24`,
          'assistant',
          'tool_calls',
          48,
          now + 48,
          JSON.stringify(readFileResult),
          JSON.stringify({
            tool_call_id: `${conversationId}-read-file-call`,
            tool_name: 'read_file',
            status: 'success',
            phase: 'complete',
            args: {
              locator: 'workspace:/e2e-workspace-document.md',
              view: 'document',
            },
            data: readFileResult.data,
            started_at: now + 47,
            completed_at: now + 48,
          }),
          `${conversationId}-run-24`,
        );

        const parentToolCallId = `${conversationId}-subagent-call`;
        const subrunId = `${conversationId}-subrun`;
        const childToolName = subrunPreview ? 'read_file' : 'list_files';
        const childToolCallId = `${subrunId}-${subrunPreview ? 'read-file' : 'list-files'}-call`;
        const childAnswerId = `${subrunId}-answer`;
        const childAnswerContent = subrunPreview
          ? '第一张幻灯片检查完成。'
          : '工作区根目录检查完成。';
        const subagentArgs = {
          description: subrunPreview ? '检查第一张幻灯片' : '检查工作区文档',
          prompt: subrunPreview
            ? '读取第一张幻灯片图片并报告结果'
            : '列出工作区根目录并报告结果',
          subagent_type: 'general',
        };
        const subagentResult = {
          data: {
            description: subagentArgs.description,
            subagent_type: subagentArgs.subagent_type,
            model_id: 'scripted-subagent-model',
            subrun_ids: [subrunId],
            status: 'completed',
            final_answer: childAnswerContent,
            artifacts: [],
          },
          observation: subrunPreview
            ? '子 Agent 已完成第一张幻灯片检查。'
            : '子 Agent 已完成工作区根目录检查。',
        };
        insertMessage.run(
          `${conversationId}-subagent`,
          conversationId,
          `${conversationId}-turn-24`,
          'assistant',
          'tool_calls',
          50,
          now + 50,
          JSON.stringify(subagentResult),
          JSON.stringify({
            tool_call_id: parentToolCallId,
            tool_name: 'subagent',
            status: 'success',
            phase: 'complete',
            args: subagentArgs,
            data: subagentResult.data,
            subrun_summary: {
              subrun_ids: [subrunId],
              event_counts: { [subrunId]: 3 },
            },
            started_at: now + 49,
            completed_at: now + 50,
          }),
          `${conversationId}-run-24`,
        );
        insertSubrunTraceRun.run(
          subrunId,
          conversationId,
          `${conversationId}-child-turn`,
          `${conversationId}-run-24`,
          parentToolCallId,
          now + 49,
        );
        insertSubrunTraceItem.run(
          subrunId,
          `${subrunId}-decision`,
          'tool_call_decision',
          now + 49,
          JSON.stringify({
            tool_calls: [{
              tool_call_id: childToolCallId,
              tool_name: childToolName,
              args: subrunPreview
                ? { locator: 'conversation:/slides-renders/run-1/slide-001.png' }
                : { locator: 'workspace:/' },
            }],
          }),
        );
        insertSubrunTraceItem.run(
          subrunId,
          `${subrunId}-output`,
          'tool_output',
          now + 50,
          JSON.stringify({
            tool_name: childToolName,
            tool_call_id: childToolCallId,
            status: 'success',
            output: {
              data: subrunPreview
                ? {
                    source_kind: 'conversation_file',
                    locator: 'conversation:/slides-renders/run-1/slide-001.png',
                    file_name: 'slide-001.png',
                    content_type: 'image/png',
                    byte_length: subrunPreview.byteLength,
                    width: subrunPreview.width,
                    height: subrunPreview.height,
                    attachment_status: 'attached',
                  }
                : {
                    source_kind: 'workspace_vfs',
                    locator: 'workspace:/',
                    entries: [],
                    documents: [],
                    total_count: 0,
                    offset: 0,
                    has_more: false,
                    include_system_nodes: false,
                  },
              observation: subrunPreview
                ? '已读取图片文件；真实像素已附加到本次工具结果。'
                : '工作区根目录为空。',
            },
            ...(subrunPreview ? { attachments: [subrunPreview] } : {}),
            duration_ms: 12,
          }),
        );
        insertSubrunTraceItem.run(
          subrunId,
          `${subrunId}-final-answer`,
          'final_answer',
          now + 51,
          JSON.stringify({
            answer_id: childAnswerId,
            content: childAnswerContent,
            completion_reason: 'terminal',
          }),
        );
      }
    }
  });
  seed();
  db.close();
}

async function restoreSourceDatabaseSnapshot() {
  if (!sourceDatabasePath) return;
  if (!existsSync(sourceDatabasePath)) {
    throw new Error(`真实数据快照源不存在: ${sourceDatabasePath}`);
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  const source = new Database(sourceDatabasePath, { readonly: true });
  try {
    await source.backup(databasePath);
  } finally {
    source.close();
  }
}

async function clickConversation(cdp, title) {
  const clicked = await evaluate(cdp, `(() => {
    const row = Array.from(document.querySelectorAll('.chat-list-item'))
      .find(element => element.querySelector('.chat-list-title')?.textContent?.trim() === ${JSON.stringify(title)});
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`侧栏未找到会话: ${title}`);
  try {
    await waitFor(
      () => evaluate(
        cdp,
        `document.body.innerText.includes(${JSON.stringify(`${title} 回答 ${seededTurnCount}`)})`,
      ),
      `${title} 完成渲染`,
    );
  } catch (error) {
    const state = await evaluate(cdp, `(() => ({
      bodyText: document.body.innerText.slice(-2000),
      activeConversationTitle: document.querySelector('.chat-list-item.is-active .chat-list-title')?.textContent?.trim() ?? null,
      hostCount: document.querySelectorAll('.conversation-chat-host').length,
      messageCount: document.querySelectorAll('[data-message-id]').length,
      emptyStateCount: document.querySelectorAll(
        '.empty-state-layout, .conversation-chat-footer-empty-layout'
      ).length,
      historyLoadPhases: window.__CONVERSATION_PERF__?.getRecentSummary(20, 'history-load') ?? [],
    }))()`);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}; 页面状态=${JSON.stringify(state)}`);
  }
}

async function clickConversationAtIndex(cdp, index) {
  const clickedTitle = await evaluate(cdp, `(() => {
    const rows = Array.from(document.querySelectorAll('.chat-list-item'));
    const row = rows[${index}];
    if (!(row instanceof HTMLElement)) return null;
    const title = row.querySelector('.chat-list-title')?.textContent?.trim() ?? '';
    row.click();
    return title;
  })()`);
  if (!clickedTitle) throw new Error(`侧栏第 ${index + 1} 条会话不存在`);
  await waitFor(
    () => evaluate(cdp, `(() => {
      const row = Array.from(document.querySelectorAll('.chat-list-item'))[${index}];
      return row instanceof HTMLElement && row.classList.contains('is-active');
    })()`),
    `第 ${index + 1} 条会话进入选中态`,
  );
  return clickedTitle;
}

async function readNavigationState(cdp) {
  return evaluate(cdp, `(async () => {
    const [
      { useAssistantStore },
      { useMessageWindowStore },
      { useHistoryLoaderStore },
      { useWorkspaceScopeStore },
    ] = await Promise.all([
      import('/apps/renderer/domains/conversation/store/assistantStore.ts'),
      import('/apps/renderer/domains/conversation/message-window/store/messageWindowStore.ts'),
      import('/apps/renderer/domains/conversation/history/store/historyLoaderStore.ts'),
      import('/apps/renderer/shared/stores/workspaceScopeStore.ts'),
    ]);
    const assistantStore = useAssistantStore();
    const messageWindowStore = useMessageWindowStore();
    const historyLoaderStore = useHistoryLoaderStore();
    const workspaceScopeStore = useWorkspaceScopeStore();
    const renderedMessageIds = Array.from(
      document.querySelectorAll('[data-conversation-message-id]'),
      element => element.getAttribute('data-conversation-message-id'),
    ).filter(value => typeof value === 'string');
    const duplicateRenderedMessageIds = renderedMessageIds.filter(
      (messageId, index) => renderedMessageIds.indexOf(messageId) !== index,
    );
    return {
      scope: workspaceScopeStore.currentScope,
      activeConversationId: assistantStore.activeConversationId,
      messageWindowConversationId: messageWindowStore.conversationId,
      messageWindowStatus: messageWindowStore.status,
      messageWindowRowCount: messageWindowStore.rows.length,
      historyLoading: historyLoaderStore.isLoading,
      historyLoadingConversationId: historyLoaderStore.loadingConversationId,
      historyError: historyLoaderStore.error,
      emptyStateCount: document.querySelectorAll(
        '.empty-state-layout, .conversation-chat-footer-empty-layout'
      ).length,
      conversationHostCount: document.querySelectorAll('.conversation-chat-host').length,
      historyLoadingStateCount: document.querySelectorAll('.history-loading-state').length,
      renderedMessageCount: renderedMessageIds.length,
      duplicateRenderedMessageIds: Array.from(new Set(duplicateRenderedMessageIds)),
    };
  })()`);
}

async function waitForActiveConversationReady(cdp) {
  return waitFor(async () => {
    const state = await readNavigationState(cdp);
    return state.activeConversationId
      && state.messageWindowConversationId === state.activeConversationId
      && state.messageWindowStatus === 'ready'
      && state.historyLoading === false
      && state.historyLoadingConversationId === null
      && state.historyLoadingStateCount === 0
      && state.conversationHostCount === 1
      ? state
      : null;
  }, '活跃会话、历史窗口与正文 DOM 同时稳定');
}

async function assertRendererHealthy(cdp, rendererErrors, phase) {
  if (rendererErrors.length === 0) return;
  const state = await readNavigationState(cdp).catch(error => ({ diagnosticError: error.message }));
  throw new Error(
    `${phase}出现 renderer 异常:\n${rendererErrors[0]}\n状态快照: ${JSON.stringify(state, null, 2)}`,
  );
}

async function runSubrunDetailNavigation(
  cdp,
  rendererErrors,
  { verifyReturnAnchor = true } = {},
) {
  const parentMessageId = 'e2e-conversation-a-subagent';
  const subrunId = 'e2e-conversation-a-subrun';
  const expectsImagePreview = scenario === 'subrun-reload';
  const expectedDescription = expectsImagePreview ? '检查第一张幻灯片' : '检查工作区文档';
  const expectedPrompt = expectsImagePreview
    ? '读取第一张幻灯片图片并报告结果'
    : '列出工作区根目录并报告结果';
  const expectedAnswer = expectsImagePreview
    ? '第一张幻灯片检查完成。'
    : '工作区根目录检查完成。';
  const childToolCallSuffix = expectsImagePreview ? 'read-file' : 'list-files';
  const childMessageId = `subrun-tool:${subrunId}:${subrunId}-${childToolCallSuffix}-call`;
  const childAnswerMessageId = `subrun_${subrunId}_answer_${subrunId}-answer`;

  await waitFor(async () => {
    if (rendererErrors.length > 0) return false;
    return evaluate(cdp, `(() => {
      const card = document.querySelector('.subrun-trace-panel');
      const toolCard = card?.closest('.tool-registry-card.tool-card');
      const parent = card?.closest('[data-conversation-message-id]');
      return card instanceof HTMLElement
        && toolCard instanceof HTMLElement
        && toolCard.querySelector('.tool-card__header') instanceof HTMLElement
        && toolCard.querySelector('.subrun-progress-card') instanceof HTMLElement
        && parent?.getAttribute('data-conversation-message-id') === ${JSON.stringify(parentMessageId)}
        && !card.querySelector('.ui-card-body--bounded')
        && !card.querySelector('.deep-trace__toggle')
        && card.querySelector('.deep-trace__action') instanceof HTMLButtonElement
        && card.querySelectorAll('.deep-trace__row').length > 0
        && !document.querySelector('.subrun-progress')
        && !document.querySelector('.tool-group-mode');
    })()`);
  }, 'Subrun 父进度卡完成历史步骤投影');

  const openDetail = await evaluate(cdp, `(() => {
    const card = document.querySelector('.subrun-trace-panel');
    const parent = card?.closest('[data-conversation-message-id]');
    const button = card?.querySelector('.deep-trace__action');
    if (!(parent instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return null;
    const offsetTop = parent.getBoundingClientRect().top;
    button.click();
    return { offsetTop };
  })()`);
  if (!Number.isFinite(openDetail?.offsetTop)) {
    throw new Error(`Subrun 详情入口不可用: ${JSON.stringify(openDetail)}`);
  }

  await waitFor(async () => {
    if (rendererErrors.length > 0) return false;
    return evaluate(cdp, `(() => {
      const state = {
        hasDetail: Boolean(document.querySelector('.subrun-detail')),
        hasParentView: Boolean(document.querySelector('.conversation-view')),
        hasChildTool: Boolean(document.querySelector(
          ${JSON.stringify(`.subrun-detail [data-conversation-message-id="${childMessageId}"] .tool-registry-card`)},
        )),
        hasChildAnswer: Boolean(document.querySelector(
          ${JSON.stringify(`.subrun-detail [data-conversation-message-id="${childAnswerMessageId}"]`)},
        )),
        hasChildAnswerContent: document.querySelector('.subrun-detail')?.textContent
          ?.includes(${JSON.stringify(expectedAnswer)}) === true,
        hasChildImagePreview: ${scenario === 'subrun-reload'
          ? `(() => {
              const image = document.querySelector(
                '.subrun-detail .image-read-card .conversation-image-gallery__preview img',
              );
              return image instanceof HTMLImageElement
                && image.complete
                && image.naturalWidth > 0
                && image.naturalHeight > 0;
            })()`
          : 'true'},
        hasReadonlyInvocation: (() => {
          const invocation = document.querySelector(
            ${JSON.stringify(`.subrun-detail [data-conversation-message-id="subrun-user:${subrunId}"]`)},
          );
          if (!(invocation instanceof HTMLElement)) return false;
          const actionButtons = invocation.querySelectorAll('.user-message-action-buttons button');
          return invocation.textContent?.includes(${JSON.stringify(expectedPrompt)}) === true
            && actionButtons.length === 1
            && actionButtons[0]?.classList.contains('user-message-copy-button') === true;
        })(),
        hasProjectionError: document.querySelector('.subrun-detail')?.textContent
          ?.includes('子任务过程未能通过展示校验') === true,
        hasRepeatedBodyTitle: Boolean(document.querySelector('.subrun-detail h2')),
        hasDetailBreadcrumb: Array.from(document.querySelectorAll('.header-pane__title')).some(title => {
          const segments = Array.from(title.querySelectorAll('.breadcrumb-segment'))
            .map(segment => segment.textContent?.trim());
          return segments.length === 2
            && segments[0] === 'E2E 对话 A'
            && segments[1] === ${JSON.stringify(expectedDescription)}
            && title.querySelector('.breadcrumb-segment--parent-action') instanceof HTMLButtonElement;
        }),
        hasInput: Boolean(document.querySelector('.ai-assistant-input')),
        hasReadOnlyFooter: Boolean(document.querySelector('.subrun-detail-footer .conversation-footer-surface')),
        hasTerminalStatus: document.querySelector('.subrun-detail-footer')?.textContent
          ?.includes('子任务已完成') === true,
        hasModel: document.querySelector('.subrun-detail-footer')?.textContent
          ?.includes('scripted-subagent-model') === true,
        hasFooterReturn: document.querySelector('.subrun-detail-footer__back') instanceof HTMLButtonElement,
      };
      return state.hasDetail
        && !state.hasParentView
        && state.hasChildTool
        && state.hasChildAnswer
        && state.hasChildAnswerContent
        && state.hasChildImagePreview
        && state.hasReadonlyInvocation
        && !state.hasProjectionError
        && !state.hasRepeatedBodyTitle
        && state.hasDetailBreadcrumb
        && !state.hasInput
        && state.hasReadOnlyFooter
        && state.hasTerminalStatus
        && state.hasModel
        && state.hasFooterReturn
        ? state
        : false;
    })()`);
  }, 'Subrun 就地详情完成完整 child tool admission');
  await assertRendererHealthy(cdp, rendererErrors, 'Subrun 详情首次打开后');

  // 详情 scope 属于当前 Host；切会话必须销毁它，不能让旧 child continuation 污染新会话。
  await clickConversation(cdp, 'E2E 对话 B');
  await waitForActiveConversationReady(cdp);
  const leakedDetail = await evaluate(cdp, `Boolean(document.querySelector('.subrun-detail'))`);
  if (leakedDetail) throw new Error('切换会话后仍残留旧 Subrun 详情 scope');
  const leakedSubrunTitle = await evaluate(cdp, `Array.from(document.querySelectorAll('.breadcrumb-segment'))
    .some(segment => segment.textContent?.trim() === ${JSON.stringify(expectedDescription)})`);
  if (leakedSubrunTitle) throw new Error('切换会话后应用 Header 仍残留旧 Subrun 标题');
  await assertRendererHealthy(cdp, rendererErrors, 'Subrun 详情切换会话后');

  await clickConversation(cdp, 'E2E 对话 A');
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('.subrun-trace-panel .deep-trace__action'))`),
    '返回父会话后 Subrun 进度卡恢复',
  );
  const returnAnchor = await evaluate(cdp, `(() => {
    const card = document.querySelector('.subrun-trace-panel');
    const parent = card?.closest('[data-conversation-message-id]');
    const button = card?.querySelector('.deep-trace__action');
    if (!(parent instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return null;
    const offsetTop = parent.getBoundingClientRect().top;
    button.click();
    return { offsetTop };
  })()`);
  if (!Number.isFinite(returnAnchor?.offsetTop)) {
    throw new Error(`Subrun 返回锚点准备失败: ${JSON.stringify(returnAnchor)}`);
  }
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('.breadcrumb-segment--parent-action'))`),
    'Subrun 详情再次打开',
  );
  const didClickBack = await evaluate(cdp, `(() => {
    const button = document.querySelector('.breadcrumb-segment--parent-action');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!didClickBack) throw new Error('Subrun Header 父对话面包屑不可用');

  await waitFor(
    () => evaluate(cdp, `Array.from(document.querySelectorAll('.header-pane__title')).some(title => {
      const segments = Array.from(title.querySelectorAll('.breadcrumb-segment'))
        .map(segment => segment.textContent?.trim());
      return segments.length === 1 && segments[0] === 'E2E 对话 A';
    })`),
    'Subrun 详情返回后应用 Header 恢复父对话标题',
  );
  if (verifyReturnAnchor) try {
    await waitFor(async () => {
      if (rendererErrors.length > 0) return false;
      return evaluate(cdp, `(() => {
        const card = document.querySelector('.subrun-trace-panel');
        const parent = card?.closest('[data-conversation-message-id]');
        if (!(parent instanceof HTMLElement)) return false;
        return Math.abs(parent.getBoundingClientRect().top - ${returnAnchor.offsetTop}) <= 2;
      })()`);
    }, 'Subrun 详情返回父消息精确锚点');
  } catch (error) {
    const diagnostic = await evaluate(cdp, `(() => {
      const card = document.querySelector('.subrun-trace-panel');
      const parent = card?.closest('[data-conversation-message-id]');
      const view = document.querySelector('.conversation-view');
      const scrollParents = [];
      let current = parent?.parentElement ?? null;
      while (current instanceof HTMLElement) {
        const style = getComputedStyle(current);
        if (/(auto|scroll)/.test(style.overflowY)) {
          scrollParents.push({
            className: current.className,
            scrollTop: current.scrollTop,
            top: current.getBoundingClientRect().top,
          });
        }
        current = current.parentElement;
      }
      return {
        expectedTop: ${returnAnchor.offsetTop},
        actualTop: parent instanceof HTMLElement ? parent.getBoundingClientRect().top : null,
        hasDetail: Boolean(document.querySelector('.subrun-detail')),
        hasView: view instanceof HTMLElement,
        scrollParents,
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; ${JSON.stringify(diagnostic)}`);
  }

  const didOpenFooterReturn = await evaluate(cdp, `(() => {
    const card = document.querySelector('.subrun-trace-panel');
    const button = card?.querySelector('.deep-trace__action');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!didOpenFooterReturn) throw new Error('Subrun 底部面板返回验证无法重新打开详情');
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('.subrun-detail-footer__back'))`),
    'Subrun 底部状态面板挂载',
  );
  const didClickFooterReturn = await evaluate(cdp, `(() => {
    const button = document.querySelector('.subrun-detail-footer__back');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!didClickFooterReturn) throw new Error('Subrun 底部面板返回按钮不可用');
  await waitFor(
    () => evaluate(cdp, `!document.querySelector('.subrun-detail') && Boolean(document.querySelector('.conversation-view'))`),
    'Subrun 底部面板返回父对话',
  );
  await assertRendererHealthy(cdp, rendererErrors, 'Subrun 详情返回父消息后');
}

async function startNewConversationDraft(cdp) {
  const clicked = await evaluate(cdp, `(() => {
    const button = document.querySelector('.sidebar-fixed-top .sidebar-entry, .project-nav-create-button');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('未找到新对话入口');
  return waitFor(async () => {
    const state = await readNavigationState(cdp);
    return state.activeConversationId === null
      && state.historyLoading === false
      && state.emptyStateCount === 1
      && state.conversationHostCount === 0
      ? state
      : null;
  }, '新对话草稿空态稳定');
}

async function runProjectionNavigationInterleaving(cdp, options) {
  const result = await evaluate(cdp, `(async () => {
    const { useAssistantStore } = await import(
      '/apps/renderer/domains/conversation/store/assistantStore.ts'
    );
    const assistantStore = useAssistantStore();
    const conversationId = 'e2e-conversation-a';
    const turnId = ${JSON.stringify(options.turnId)};
    const answerId = ${JSON.stringify(options.answerId)};
    const executionScope = {
      run_id: ${JSON.stringify(options.runId)},
      execution_id: ${JSON.stringify(options.executionId)},
    };

    const firstChunk = await assistantStore.handleSseEvent(conversationId, {
      ...executionScope,
      type: 'final_answer_chunk',
      id: ${JSON.stringify(`${options.answerId}-chunk-0`)},
      timestamp: Date.now(),
      conversation_id: conversationId,
      turn_id: turnId,
      answer_id: answerId,
      seq: 0,
      chunk: ${JSON.stringify(options.firstChunk)},
    });
    if (!firstChunk.success) return { phase: 'first-chunk', result: firstChunk };

    const navigationTarget = ${options.target === 'draft'
      ? `document.querySelector('.sidebar-fixed-top .sidebar-entry, .project-nav-create-button')`
      : `Array.from(document.querySelectorAll('.chat-list-item'))
          .find(element => element.querySelector('.chat-list-title')?.textContent?.trim() === 'E2E 对话 B')`};
    if (!(navigationTarget instanceof HTMLElement)) {
      return { phase: 'navigation-target', result: null };
    }
    navigationTarget.click();

    const lastChunk = await assistantStore.handleSseEvent(conversationId, {
      ...executionScope,
      type: 'final_answer_chunk',
      id: ${JSON.stringify(`${options.answerId}-chunk-1`)},
      timestamp: Date.now() + 1,
      conversation_id: conversationId,
      turn_id: turnId,
      answer_id: answerId,
      seq: 1,
      chunk: ${JSON.stringify(options.lastChunk)},
      is_last: true,
    });
    if (!lastChunk.success) return { phase: 'last-chunk', result: lastChunk };

    const terminal = await assistantStore.handleSseEvent(conversationId, {
      ...executionScope,
      type: 'final_answer',
      id: answerId,
      timestamp: Date.now() + 2,
      conversation_id: conversationId,
      turn_id: turnId,
      answer_id: answerId,
      content: ${JSON.stringify(`${options.firstChunk}${options.lastChunk}`)},
      completion_reason: 'terminal',
    });
    return { phase: 'complete', result: terminal };
  })()`);

  if (result?.phase !== 'complete' || result.result?.success !== true) {
    throw new Error(`投影与导航交错失败: ${JSON.stringify(result)}`);
  }
}

async function runProjectionFailureNavigationInterleaving(cdp) {
  const result = await evaluate(cdp, `(async () => {
    const [{ useAssistantStore }, { useInteractiveRunStore }] = await Promise.all([
      import('/apps/renderer/domains/conversation/store/assistantStore.ts'),
      import('/apps/renderer/domains/conversation/features/interactive-run/store/interactiveRunStore.ts'),
    ]);
    const assistantStore = useAssistantStore();
    const interactiveRunStore = useInteractiveRunStore();
    const conversationId = 'e2e-conversation-a';
    assistantStore.startInteractiveRun(new AbortController());

    const projection = await assistantStore.handleSseEvent(conversationId, {
      type: 'final_answer',
      id: 'e2e-protocol-failure-answer',
      timestamp: Date.now(),
      conversation_id: conversationId,
      turn_id: 'e2e-protocol-failure-turn',
      run_id: 'e2e-protocol-failure-run',
      execution_id: 'e2e-protocol-failure-execution',
      answer_id: 'e2e-protocol-failure-answer',
      content: '缺少实时 chunk 的完整答案不能进入正文',
      completion_reason: 'terminal',
    });
    if (projection.success) return { phase: 'protocol-accepted', projection };

    interactiveRunStore.failRun(conversationId, '对话执行失败');
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const errorBannerVisible = document.body.innerText.includes('对话执行失败');
    if (!errorBannerVisible) {
      return { phase: 'error-banner', projection };
    }
    const navigationTarget = Array.from(document.querySelectorAll('.chat-list-item'))
      .find(element => element.querySelector('.chat-list-title')?.textContent?.trim() === 'E2E 对话 B');
    if (!(navigationTarget instanceof HTMLElement)) {
      return { phase: 'navigation-target', projection };
    }
    navigationTarget.click();
    return { phase: 'complete', projection };
  })()`);

  if (
    result?.phase !== 'complete'
    || result.projection?.success !== false
    || !String(result.projection?.reason).includes('arrived without a live chunk stream')
  ) {
    throw new Error(`协议失败与导航交错未命中预期分支: ${JSON.stringify(result)}`);
  }
}

async function runCopyFeedbackCycle(cdp, rendererErrors, options) {
  const buttonSelector = JSON.stringify(options.buttonSelector);
  const iconSelector = JSON.stringify(options.iconSelector);
  const feedbackSelector = JSON.stringify(options.feedbackSelector);
  const copyTarget = await evaluate(cdp, `(() => {
    const buttons = Array.from(document.querySelectorAll(${buttonSelector}));
    const button = buttons.at(-1);
    if (!(button instanceof HTMLButtonElement)) return { phase: 'copy-button' };
    const rect = button.getBoundingClientRect();
    return {
      phase: 'copy-target',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  })()`);
  if (
    copyTarget?.phase !== 'copy-target'
    || !Number.isFinite(copyTarget.x)
    || !Number.isFinite(copyTarget.y)
    || !(copyTarget.width > 0)
    || !(copyTarget.height > 0)
  ) {
    throw new Error(`${options.description}按钮不可用: ${JSON.stringify(copyTarget)}`);
  }
  const mousePosition = { x: copyTarget.x, y: copyTarget.y };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...mousePosition });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...mousePosition,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...mousePosition,
  });

  const copied = await waitFor(async () => {
    if (rendererErrors.length > 0) return { phase: 'renderer-error' };
    const feedbackState = await evaluate(cdp, `(() => {
      const button = Array.from(document.querySelectorAll(${buttonSelector})).at(-1);
      const icon = button?.querySelector(${iconSelector});
      const feedback = button?.querySelector(${feedbackSelector});
      return {
        iconHidden: icon instanceof HTMLElement && icon.hidden,
        feedbackVisible: feedback instanceof HTMLElement && !feedback.hidden,
      };
    })()`);
    return feedbackState?.iconHidden === true && feedbackState.feedbackVisible === true
      ? { phase: 'copied', ...feedbackState }
      : false;
  }, `${options.description}反馈显示`);
  await assertRendererHealthy(cdp, rendererErrors, `${options.description}反馈显示后`);
  if (copied?.phase !== 'copied') {
    throw new Error(`${options.description}反馈不符合预期: ${JSON.stringify(copied)}`);
  }

  const reset = await waitFor(async () => {
    if (rendererErrors.length > 0) return { phase: 'renderer-error' };
    const feedbackState = await evaluate(cdp, `(() => {
      const button = Array.from(document.querySelectorAll(${buttonSelector})).at(-1);
      const icon = button?.querySelector(${iconSelector});
      const feedback = button?.querySelector(${feedbackSelector});
      return {
        iconVisible: icon instanceof HTMLElement && !icon.hidden,
        feedbackHidden: feedback instanceof HTMLElement && feedback.hidden,
      };
    })()`);
    return feedbackState?.iconVisible === true && feedbackState.feedbackHidden === true
      ? { phase: 'reset', ...feedbackState }
      : false;
  }, `${options.description}反馈复位`, 3_000);
  await assertRendererHealthy(cdp, rendererErrors, `${options.description}反馈复位后`);
  if (reset?.phase !== 'reset') {
    throw new Error(`${options.description}反馈未按时恢复: ${JSON.stringify(reset)}`);
  }
}

async function runUserMessageCopyFeedback(cdp, rendererErrors) {
  await runCopyFeedbackCycle(cdp, rendererErrors, {
    buttonSelector: '.user-message-copy-button',
    iconSelector: '.copy-feedback-icon',
    feedbackSelector: '.copied-text',
    description: '用户消息复制',
  });
}

async function runConversationAnswerCopyFeedback(cdp, rendererErrors) {
  await runCopyFeedbackCycle(cdp, rendererErrors, {
    buttonSelector: '.conversation-answer-copy-button',
    iconSelector: '.copy-action-icon',
    feedbackSelector: '.action-text',
    description: '助手回答复制',
  });
}

async function runConversationResourceLinks(cdp, rendererErrors) {
  const admission = await evaluate(cdp, `window.electronAPI.resolveConversationFileLink({
    conversation_id: ${JSON.stringify(resourceLinkConversationId)},
    locator: ${JSON.stringify(resourceLinkConversationLocator)},
  })`);
  if (admission?.success !== true || admission.data?.state !== 'missing') {
    throw new Error(`Conversation 工作目录 admission 结果异常: ${JSON.stringify(admission)}`);
  }
  const conversationFile = join(
    resolveConversationWorkDirectory(resourceLinkConversationId),
    'renders',
    '预览图.png',
  );
  mkdirSync(dirname(conversationFile), { recursive: true });
  writeFileSync(conversationFile, 'e2e conversation file');

  await clickConversation(cdp, 'E2E 对话 A');
  await waitForActiveConversationReady(cdp);
  const presentation = await waitFor(
    () => evaluate(cdp, `(() => {
      const links = Array.from(document.querySelectorAll('.conversation-resource-link'));
      if (links.length !== 3 || links.some(link => link.classList.contains('is-disabled'))) return null;
      return links.map(link => ({
        href: link.getAttribute('href'),
        text: link.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      }));
    })()`),
    '三个资源链接完成 owner 解析',
  );
  if (!presentation.some(item => item.href?.startsWith('workspace:')
    && item.text.includes(resourceLinkWorkspaceTitle)
    && !item.text.includes('模型写错的标题'))) {
    throw new Error(`Workspace 链接没有使用 owner 标题: ${JSON.stringify(presentation)}`);
  }
  if (!presentation.some(item => item.href?.startsWith('conversation:')
    && item.text.includes('生成预览') && item.text.includes('.png'))) {
    throw new Error(`Conversation 链接展示不符合约定: ${JSON.stringify(presentation)}`);
  }
  if (!presentation.some(item => item.href?.startsWith('file:')
    && item.text.includes('外部报告') && item.text.includes('.pdf'))) {
    throw new Error(`Host file 链接展示不符合约定: ${JSON.stringify(presentation)}`);
  }

  for (const locatorPrefix of ['conversation:', 'file:']) {
    const clicked = await evaluate(cdp, `(() => {
      const link = Array.from(document.querySelectorAll('.conversation-resource-link'))
        .find(element => element.getAttribute('href')?.startsWith(${JSON.stringify(locatorPrefix)}));
      if (!(link instanceof HTMLAnchorElement)) return false;
      link.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`无法点击 ${locatorPrefix} 资源链接`);
    await wait(300);
    await assertRendererHealthy(cdp, rendererErrors, `${locatorPrefix} 文件管理器定位后`);
    const openFailed = await evaluate(
      cdp,
      `document.body.innerText.includes('无法打开这个文件链接')`,
    );
    if (openFailed) throw new Error(`${locatorPrefix} 文件管理器定位失败`);
  }

  const workspaceClicked = await evaluate(cdp, `(() => {
    const link = Array.from(document.querySelectorAll('.conversation-resource-link'))
      .find(element => element.getAttribute('href')?.startsWith('workspace:'));
    if (!(link instanceof HTMLAnchorElement)) return false;
    link.click();
    return true;
  })()`);
  if (!workspaceClicked) throw new Error('无法点击 Workspace 资源链接');
  await waitFor(
    () => evaluate(cdp, `(async () => {
      const { useLayoutStore } = await import('/apps/renderer/app/layout/store/layoutStore.ts');
      const activeDocument = useLayoutStore().state.activeDocument;
      return activeDocument?.id === ${JSON.stringify(resourceLinkWorkspaceDocumentId)}
        && activeDocument?.projectId !== undefined;
    })()`),
    'Workspace 资源链接进入应用内文档',
  );
  await assertRendererHealthy(cdp, rendererErrors, 'Workspace 资源链接跳转后');
}

function formatRuntimeException(params) {
  const details = params.exceptionDetails;
  return details.exception?.description ?? details.text ?? 'Runtime.exceptionThrown';
}

async function run() {
  for (const requiredPath of [
    'dist/main/main.cjs',
    'dist/main/preload.js',
    'dist/main/app-server-entry.cjs',
    'dist/main/app-server-backend.cjs',
  ]) {
    if (!existsSync(join(repoRoot, requiredPath))) {
      throw new Error(`缺少 ${requiredPath}，请先完成 Electron 开发构建`);
    }
  }

  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(userDataRoot, { recursive: true });
  mkdirSync(pluginRoot, { recursive: true });
  await restoreSourceDatabaseSnapshot();

  const vitePort = await findAvailablePort([5173, 5174]);
  const debugPort = await findAvailablePort(Array.from({ length: 50 }, (_, index) => 9323 + index));
  const apiPort = await findAvailablePort(Array.from({ length: 100 }, (_, index) => 34000 + index));
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  const viteProcess = spawnLogged('pnpm', [
    'exec', 'vite', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
  ], { label: 'vite', env: {} });
  let electronOutputTail = '';
  let duplicateDiagnosticLogOwnerFailure = false;
  let observedProcessTree = null;
  const electronProcess = spawnLogged('./node_modules/.bin/electron', [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataRoot}`,
    'dist/main/main.cjs',
  ], {
    label: 'electron',
    env: {
      NODE_ENV: 'development',
      LINNYA_DEV_MODE: 'false',
      LINNYA_DISABLE_UPDATE_CHECKS: '1',
      LINNYA_API_PORT: String(apiPort),
      LINNYA_WORKSPACE_DIR: workspaceRoot,
      LINNYA_PLUGIN_ROOT: pluginRoot,
      LINNYA_BUNDLED_PLUGIN_ROOT: join(repoRoot, 'extraResources/plugins'),
      VITE_DEV_SERVER_URL: viteUrl,
      APP_VERSION: '0.0.0-e2e',
    },
    observeOutput(chunk) {
      electronOutputTail = `${electronOutputTail}${chunk}`.slice(-2048);
      duplicateDiagnosticLogOwnerFailure ||= (
        electronOutputTail.includes('Failed to enable file logging')
        || electronOutputTail.includes('活动日志 writer 已启动，不能在同一生命周期切换文件路径')
      );
    },
  });

  const cleanup = async () => {
    await Promise.all([
      stopProcessTree(electronProcess, 'SIGINT'),
      stopProcessTree(viteProcess, 'SIGTERM'),
    ]);
  };

  try {
    await waitFor(() => getHttpJson(debugPort, '/json/version'), 'Electron CDP');
    // 数据只能在完整 migration 与 route admission 之后写入；仅看到表已创建并不代表 schema bootstrap 已结束。
    await waitFor(() => getHttpJson(apiPort, '/health'), '隔离后端完成启动');
    observedProcessTree = await observeMacosAppServerIdentity(electronProcess.pid);
    if (duplicateDiagnosticLogOwnerFailure) {
      throw new Error('Electron Main 与 App Server 竞争诊断日志 writer');
    }
    await waitFor(() => {
      const logDirectory = join(workspaceRoot, 'logs');
      if (!existsSync(logDirectory)) return false;
      return readdirSync(logDirectory)
        .filter(name => name.startsWith('backend-') && name.endsWith('.log'))
        .some(name => readFileSync(join(logDirectory, name), 'utf8')
          .includes('[App-Server-Backend] Initializing App Server Backend...'));
    }, 'App Server 日志进入 App 唯一文件 writer');
    await waitFor(() => existsSync(databasePath), '隔离 workspace.sqlite');
    const page = await waitFor(async () => {
      const targets = await getHttpJson(debugPort, '/json/list');
      return targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    }, 'Electron 页面');
    const projectId = await waitFor(() => {
      const db = openNodeDatabase({ readonly: true });
      try {
        return db.prepare('SELECT id FROM projects ORDER BY created_at ASC LIMIT 1').get()?.id;
      } finally {
        db.close();
      }
    }, '默认项目完成 admission');
    if (!sourceDatabasePath) {
      seedConversations(projectId);
      if (scenario === 'resource-link') {
        writeFileSync(resourceLinkHostFile, 'e2e host file');
      }
      await waitFor(() => {
        const db = openNodeDatabase({ readonly: true });
        try {
          return db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE project_id = ?').get(projectId).count === 2;
        } finally {
          db.close();
        }
      }, '两条会话事实落入隔离数据库');
    }
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    const rendererErrors = [];
    cdp.onEvent((event) => {
      if (event.method === 'Runtime.exceptionThrown') {
        rendererErrors.push(formatRuntimeException(event.params));
      }
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        const text = event.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ');
        if (/Unhandled error|Cannot read properties|Maximum recursive updates|\[HistoryLoader\]|\[SubrunDetail\]|\[SubrunTracePanel\]/i.test(text)) {
          rendererErrors.push(text);
        }
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const previousPageTimeOrigin = await evaluate(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload', { ignoreCache: true });

    await waitFor(
      () => evaluate(cdp, `performance.timeOrigin !== ${JSON.stringify(previousPageTimeOrigin)}
        && Boolean(document.querySelector('.project-row, .project-chat-panel'))`),
      '项目会话入口完成渲染',
    );
    // fixture 在应用首次读取空列表后才写入数据库；显式走正式 history list action
    // 建立 seed 后的响应式快照，避免把测试数据注入时序误判为侧栏产品行为。
    const seededConversationCount = await evaluate(cdp, `(async () => {
      const { useHistoryListStore } = await import(
        '/apps/renderer/domains/conversation/history/store/historyListStore.ts'
      );
      const scope = { kind: 'project', projectId: ${JSON.stringify(projectId)} };
      const historyListStore = useHistoryListStore();
      await historyListStore.loadScopeList(scope, {
        refresh: true,
        loadAll: true,
        limit: 100,
      });
      return historyListStore.getConversationsByScope(scope).length;
    })()`);
    if (seededConversationCount < 2) {
      throw new Error(`seed 后 history list 快照不完整: ${seededConversationCount}`);
    }
    const hasVisibleConversationList = await evaluate(cdp, `document.querySelectorAll('.chat-list-item').length >= 2`);
    if (!hasVisibleConversationList) {
      await evaluate(cdp, `document.querySelector('.project-row')?.click()`);
    }
    await waitFor(
      () => evaluate(cdp, `document.querySelectorAll('.chat-list-item').length >= 2`),
      '两条历史会话进入侧栏',
    );

    if (scenario === 'side-pane-draft') {
      await runSidePaneDraftAssembly({
        cdp,
        rendererErrors,
        projectId,
        evaluate,
        waitFor,
        clickConversation,
        startNewConversationDraft,
        assertRendererHealthy,
      });
      cdp.close();
      console.log('[conversation-navigation-e2e] 右侧新对话空态、底部输入框与草稿切换通过，renderer 无异常。');
      return;
    }

    if (scenario === 'user-message-copy') {
      if (sourceDatabasePath) {
        await clickConversationAtIndex(cdp, 0);
        await waitForActiveConversationReady(cdp);
      } else {
        await clickConversation(cdp, 'E2E 对话 B');
      }
      await runUserMessageCopyFeedback(cdp, rendererErrors);
      await runConversationAnswerCopyFeedback(cdp, rendererErrors);
      await assertRendererHealthy(cdp, rendererErrors, '会话复制反馈完成后');
      cdp.close();
      console.log('[conversation-navigation-e2e] 用户消息与助手回答复制反馈通过，renderer 无异常。');
      return;
    }

    if (scenario === 'subrun-reload') {
      if (sourceDatabasePath) {
        throw new Error('Subrun reload 门禁使用隔离 fixture，不接受外部数据库快照');
      }
      await clickConversationAtIndex(cdp, 0);
      await waitForActiveConversationReady(cdp);
      // 短父时间线的父卡天然位于 scrollTop=0 附近，没有向上补偿任意 offset 的物理空间；
      // 本场景仍完整验证详情 Header、切会话清理、重新进入和返回，精确滚动锚点由长时间线门禁负责。
      await runSubrunDetailNavigation(cdp, rendererErrors, {
        verifyReturnAnchor: false,
      });
      await assertRendererHealthy(cdp, rendererErrors, 'Subrun durable history 重载完成后');
      cdp.close();
      console.log('[conversation-navigation-e2e] Subrun durable trace 图片重载、详情 admission 与真实预览通过，renderer 无异常。');
      return;
    }

    if (scenario === 'projection-settlement') {
      if (sourceDatabasePath) {
        throw new Error('Projection settlement 门禁使用隔离 fixture，不接受外部数据库快照');
      }
      await clickConversation(cdp, 'E2E 对话 A');
      await waitForActiveConversationReady(cdp);
      await runProjectionSettlementReplay({
        cdp,
        rendererErrors,
        evaluate,
        waitFor,
        assertRendererHealthy,
      });
      cdp.close();
      console.log('[conversation-navigation-e2e] 脱敏 Thought/Subrun 回放、单一 tail geometry 与终态释放通过。');
      return;
    }

    if (scenario === 'resource-link') {
      if (sourceDatabasePath) {
        throw new Error('资源链接门禁使用隔离 fixture，不接受外部数据库快照');
      }
      await runConversationResourceLinks(cdp, rendererErrors);
      cdp.close();
      console.log('[conversation-navigation-e2e] Workspace 应用内打开、Conversation/Host 文件管理器定位通过。');
      return;
    }

    if (sourceDatabasePath) {
      const visibleConversationCount = await evaluate(cdp, `document.querySelectorAll('.chat-list-item').length`);
      const readyConversationCount = (() => {
        const db = openNodeDatabase({ readonly: true });
        try {
          return db.prepare(`
            SELECT COUNT(*) AS count
            FROM (
              SELECT projection.status
              FROM conversations AS conversation
              LEFT JOIN conversation_ui_projection_state AS projection
                ON projection.conversation_id = conversation.conversation_id
              WHERE conversation.project_id = ?
              ORDER BY conversation.is_pinned DESC, conversation.last_event_at DESC
              LIMIT 5
            )
            WHERE status = 'ready'
          `).get(projectId).count;
        } finally {
          db.close();
        }
      })();
      const navigationCount = Math.min(visibleConversationCount, readyConversationCount, 5);
      if (navigationCount < 2) {
        throw new Error(`真实快照至少需要两条 projection ready 的可见会话，当前为 ${navigationCount}`);
      }
      for (let cycle = 0; cycle < 3; cycle += 1) {
        for (let index = 0; index < navigationCount; index += 1) {
          await clickConversationAtIndex(cdp, index);
          const state = await waitForActiveConversationReady(cdp);
          if (state.duplicateRenderedMessageIds.length > 0) {
            throw new Error(`渲染消息 ID 重复: ${JSON.stringify(state)}`);
          }
          await assertRendererHealthy(cdp, rendererErrors, `第 ${cycle + 1} 轮第 ${index + 1} 条会话稳定后`);
        }
      }

      await startNewConversationDraft(cdp);
      await assertRendererHealthy(cdp, rendererErrors, '历史会话切到新对话草稿后');

      await clickConversationAtIndex(cdp, 0);
      await waitForActiveConversationReady(cdp);
      await assertRendererHealthy(cdp, rendererErrors, '新对话草稿返回历史会话后');

      cdp.close();
      console.log(
        `[conversation-navigation-e2e] 真实数据库快照的 ${navigationCount} 条可见会话完成多轮切换、草稿切换与返回，renderer 无异常。`,
      );
      return;
    }

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await clickConversation(cdp, 'E2E 对话 A');
      await clickConversation(cdp, 'E2E 对话 B');
    }

    await clickConversation(cdp, 'E2E 对话 A');
    await waitFor(async () => rendererErrors.length > 0 || evaluate(
      cdp,
      `Array.from(document.querySelectorAll('.tool-registry-card .tool-card__name-text'))
        .some(element => element.textContent?.includes('E2E Workspace 文档'))`,
    ), 'read_file Workspace 工具标题完成渲染');
    await assertRendererHealthy(cdp, rendererErrors, 'read_file Workspace 工具标题挂载后');
    await runSubrunDetailNavigation(cdp, rendererErrors);
    await runProjectionNavigationInterleaving(cdp, {
      target: 'conversation',
      turnId: 'e2e-live-navigation-turn',
      answerId: 'e2e-live-navigation-answer',
      runId: 'e2e-live-navigation-run',
      executionId: 'e2e-live-navigation-execution',
      firstChunk: '导航交错实时回答前半段',
      lastChunk: '与后半段',
    });
    await waitFor(
      () => evaluate(cdp, `document.body.innerText.includes('E2E 对话 B 回答 24')`),
      '流式投影交错后 B 会话完成渲染',
    );
    await clickConversation(cdp, 'E2E 对话 A');
    await waitFor(
      () => evaluate(cdp, `document.body.innerText.includes('导航交错实时回答前半段与后半段')`),
      '后台完成的 A 会话答案完成渲染',
    );

    await runProjectionNavigationInterleaving(cdp, {
      target: 'draft',
      turnId: 'e2e-live-draft-turn',
      answerId: 'e2e-live-draft-answer',
      runId: 'e2e-live-draft-run',
      executionId: 'e2e-live-draft-execution',
      firstChunk: '草稿交错实时回答前半段',
      lastChunk: '与后半段',
    });
    await waitFor(
      () => evaluate(cdp, `Boolean(document.querySelector('.empty-state-layout')) && !document.querySelector('.conversation-chat-host')`),
      '流式投影交错后新对话空态原子替换旧 Host',
    );
    await clickConversation(cdp, 'E2E 对话 A');
    await waitFor(
      () => evaluate(cdp, `document.body.innerText.includes('草稿交错实时回答前半段与后半段')`),
      '草稿期间后台完成的 A 会话答案完成渲染',
    );

    await runProjectionFailureNavigationInterleaving(cdp);
    await waitFor(
      () => evaluate(cdp, `document.body.innerText.includes('E2E 对话 B 回答 24')`),
      '协议失败交错后 B 会话完成渲染',
    );
    await clickConversation(cdp, 'E2E 对话 A');
    await waitFor(
      () => evaluate(cdp, `document.body.innerText.includes('E2E 对话 A 回答 24')`),
      '协议失败会话返回后历史正文完成渲染',
    );

    await clickConversation(cdp, 'E2E 对话 A');
    const startedDraft = await evaluate(cdp, `(() => {
      const button = document.querySelector(
        '.sidebar-fixed-top .sidebar-entry, .project-nav-create-button',
      );
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    if (!startedDraft) throw new Error('未找到新对话入口');
    await waitFor(
      () => evaluate(cdp, `Boolean(document.querySelector('.empty-state-layout')) && !document.querySelector('.conversation-chat-host')`),
      '新对话空态原子替换旧 Host',
    );
    await clickConversation(cdp, 'E2E 对话 B');
    await wait(500);

    await runSidePaneDraftAssembly({
      cdp,
      rendererErrors,
      projectId,
      evaluate,
      waitFor,
      clickConversation,
      startNewConversationDraft,
      assertRendererHealthy,
    });

    if (rendererErrors.length > 0) {
      throw new Error(`renderer 首个异常:\n${rendererErrors[0]}`);
    }

    cdp.close();
    console.log('[conversation-navigation-e2e] A/B 切换、新草稿与返回历史会话通过，renderer 无异常。');
  } finally {
    await cleanup();
    try {
      if (observedProcessTree) {
        // Main 退出与 owner watchdog 确认整树为空是两个异步终态；必须有界等待，
        // 但超时后仍按启动时身份精确报告泄漏，不用 PID 瞬时复用做判断。
        const survivingDescendants = await waitForObservedDescendantsExit(
          observedProcessTree.descendants,
        );
        assert.deepEqual(
          survivingDescendants,
          [],
          `App 退出后仍有原进程树后代存活: ${survivingDescendants.map(instance => instance.pid).join(',')}`,
        );
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

run().catch((error) => {
  console.error('[conversation-navigation-e2e] 失败:', error);
  process.exitCode = 1;
});
