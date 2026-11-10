import { createBackendRendererRequestRegistry } from 'src/app-hosts/linnya/adapters/backend-renderer-requests';
import { syncBackendPluginRuntimeEffects } from 'src/app-hosts/linnya/plugin-registry/runtimeEffectRuntime';
import { transferWorkspaceNode } from 'src/features/workspace/node-transfer/orchestration/transferWorkspaceNode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import { createProjectLifecycle } from 'src/domains/projects';
import { attachCitationSourceResolver } from 'src/domains/citation';
import { createSqliteActionLedger, withActionActor } from 'src/domains/action-ledger';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  registerDocumentTypeBackendHook,
  unregisterDocumentTypeBackendHook,
} from 'src/plugin-sdk/backend/documentTypeBackendHook';
import type { ToolContext } from '../../../types';
import { WriteFileTool } from '../../write_file/WriteFileTool';
import { EditFileTool } from '../../edit_file/EditFileTool';

const pluginType = 'ledger_fixture';
let database: DatabaseService;
let workspace: WorkspaceService;
let projectId: string;

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  projectId = createProjectLifecycle(database.getDb()).create({ name: 'Ledger' });
  let version = 0;
  registerDocumentTypeBackendHook({
    docType: pluginType,
    displayName: 'Ledger fixture',
    fileExtension: '.ledger-fixture',
    isEnabled: () => true,
    createDocument: async ({ projectId: target, parentId, name }) => ({
      documentId: workspace.createDocument(target, name, parentId, pluginType),
    }),
    writeDocument: async () => ({ versionNumber: (version += 1) }),
  });
});

afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  unregisterDocumentTypeBackendHook(pluginType);
  database.close();
});

function contextFor(identity: { readonly runId?: string; readonly callId: string }): ToolContext {
  const context: ToolContext = {
    databaseService: database,
    workspaceService: workspace,
    workspaceProjectId: projectId,
    conversationId: 'conv-ledger',
    parentToolCallId: ToolCallIdSchema.parse(identity.callId),
    ...(identity.runId ? { runId: RunIdSchema.parse(identity.runId), rootRunId: identity.runId } : {}),
  };
  attachCitationSourceResolver(context, { resolveSources: async () => [], resolveSourcesByUrl: async () => [] });
  return context;
}

function changes(rootRunId?: string) {
  return createSqliteActionLedger(database.getDb()).listDocumentChanges({
    projectId, ...(rootRunId ? { rootRunId } : {}), limit: 20,
  });
}

function rowCount(): number {
  return database.getDb().prepare('SELECT id FROM action_ledger_entries').all().length;
}

describe('文件工具的 Host 粗账', () => {
  it('Markdown 新建、改写、编辑各记一条；规范化后无变化的写入不记', async () => {
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/notes/plan.md', content: '# Plan\n\nFirst draft.' }, contextFor({ runId: 'run-a', callId: 'c1' }));
    await write.run({ locator: 'workspace:/notes/plan.md', content: '# Plan\n\nSecond draft.' }, contextFor({ runId: 'run-a', callId: 'c2' }));
    await write.run({ locator: 'workspace:/notes/plan.md', content: '# Plan\n\nSecond draft.' }, contextFor({ runId: 'run-a', callId: 'c3' }));
    expect(rowCount()).toBe(2);
    await new EditFileTool().run(
      { locator: 'workspace:/notes/plan.md', old_string: 'Second draft.', new_string: 'Third draft.' },
      contextFor({ runId: 'run-a', callId: 'c4' })
    );

    const result = changes('run-a');
    expect(result.truncated).toBe(false);
    expect(result.changes).toEqual([
      expect.objectContaining({
        documentType: 'document',
        actorKind: 'run',
        runId: 'run-a',
        rootRunId: 'run-a',
        parentRunId: null,
        conversationId: 'conv-ledger',
        actions: ['create', 'update'],
        entryCount: 3,
        granularity: 'coarse',
      }),
    ]);
    const callIds = database.getDb().prepare('SELECT tool_call_id FROM action_ledger_entries ORDER BY id').pluck().all();
    expect(callIds).toEqual(['c1', 'c2', 'c4']);
  });

  it('插件文档的新建与写入在插件提交后入账，写入带插件的版本引用', async () => {
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/deck.ledger-fixture', content: 'v1' }, contextFor({ runId: 'run-b', callId: 'p1' }));
    await write.run({ locator: 'workspace:/deck.ledger-fixture', content: 'v2' }, contextFor({ runId: 'run-b', callId: 'p2' }));

    expect(changes('run-b').changes).toEqual([
      expect.objectContaining({ documentType: pluginType, actions: ['create', 'update'], entryCount: 2 }),
    ]);
    const refs = database.getDb().prepare('SELECT action, after_ref FROM action_ledger_entries ORDER BY id').all();
    expect(refs).toEqual([{ action: 'create', after_ref: null }, { action: 'update', after_ref: '1' }]);
  });

  it('文档连同子树移入新项目，旧项目的删除不会删账，查询不能取得原运行与对话', async () => {
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/folder/move.md', content: 'move' }, contextFor({ runId: 'private-run', callId: 'm1' }));
    const db = database.getDb();
    const ledger = createSqliteActionLedger(db);
    const target = createProjectLifecycle(db).create({ name: 'Target' });
    const [folder] = workspace.getChildNodes(null, projectId);
    expect(folder).toBeDefined();
    if (!folder) throw new Error('Expected the created folder');
    transferWorkspaceNode({ db, nodeId: folder.id, targetProjectId: target });
    expect(changes().changes).toHaveLength(0);
    expect(ledger.listDocumentChanges({ projectId: target, rootRunId: 'private-run', limit: 5 }).changes).toHaveLength(0);
    createProjectLifecycle(db).delete(projectId);
    expect(ledger.listDocumentChanges({ projectId: target, limit: 5 }).changes).toEqual([
      expect.objectContaining({ runId: null, rootRunId: null, conversationId: null, actions: ['create'] }),
    ]);
  });

  it('交错的界面与插件后台调用由 Host 绑定身份，参数不能冒充另一个执行者', async () => {
    const write = new WriteFileTool();
    const registry = createBackendRendererRequestRegistry();
    registry.handle('workspace:test-write', () => write.run({ locator: 'workspace:/user.md', content: 'user' }, contextFor({ callId: 'u' })));
    try {
      await Promise.all([
        registry.invoke('workspace:test-write', [{ actor: 'plugin' }]),
        syncBackendPluginRuntimeEffects([{ pluginId: 'fixture', effect: {
          id: 'write', activate: async () => {
            await write.run({ locator: 'workspace:/plugin.md', content: 'plugin' }, contextFor({ callId: 'p' }));
          }, deactivate: () => {},
        } }]),
      ]);
      expect(changes().changes.map(c => [c.actorKind, c.pluginId])).toEqual(expect.arrayContaining([['user', null], ['plugin', 'fixture']]));
    } finally {
      await syncBackendPluginRuntimeEffects([]);
    }
  });

  it('外部控制桥接纳的原始 Host 工具调用记为 external 并带运行身份；同入口的模型调用和界面的 Host 调用仍记为运行', async () => {
    const write = new WriteFileTool();
    const hostCall = (callId: string, runId: string): ToolContext => ({
      ...contextFor({ runId, callId }),
      authorizedHostToolCall: { toolName: 'write_file', toolCallId: ToolCallIdSchema.parse(callId) },
    });
    // CLI tools call：桥入口 + 那次原始 Host 调用。
    await withActionActor({ kind: 'external' }, () =>
      write.run({ locator: 'workspace:/cli.md', content: '# CLI' }, hostCall('h1', 'run-cli')));
    // CLI send：桥入口，但写入来自模型自己的调用，不是原始 Host 调用。
    await withActionActor({ kind: 'external' }, () =>
      write.run({ locator: 'workspace:/send.md', content: '# Send' }, contextFor({ runId: 'run-send', callId: 'm1' })));
    // 界面的 Host 调用（表格填充等）：入口身份是用户。
    await withActionActor({ kind: 'user' }, () =>
      write.run({ locator: 'workspace:/ui.md', content: '# UI' }, hostCall('h2', 'run-ui')));

    expect(changes('run-cli').changes).toEqual([
      expect.objectContaining({
        actorKind: 'external', runId: 'run-cli', rootRunId: 'run-cli', conversationId: 'conv-ledger', actions: ['create'],
      }),
    ]);
    expect(changes('run-send').changes.map(change => change.actorKind)).toEqual(['run']);
    expect(changes('run-ui').changes.map(change => change.actorKind)).toEqual(['run']);
    const toolCall = database.getDb()
      .prepare("SELECT tool_call_id FROM action_ledger_entries WHERE actor_kind = 'external'").pluck().get();
    expect(toolCall).toBe('h1');
  });

  it('没有运行编号的上下文照常写入但不入账；不同运行分开查询', async () => {
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/plain.md', content: 'No run' }, contextFor({ callId: 'n1' }));
    expect(rowCount()).toBe(0);
    await write.run({ locator: 'workspace:/other.md', content: 'Run C' }, contextFor({ runId: 'run-c', callId: 'r1' }));
    expect(changes('run-a').changes).toEqual([]);
    expect(changes().changes.map(change => change.runId)).toEqual(['run-c']);
  });
});
