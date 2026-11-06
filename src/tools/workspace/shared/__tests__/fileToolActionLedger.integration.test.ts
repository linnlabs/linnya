import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import { createProjectLifecycle } from 'src/domains/projects';
import { attachCitationSourceResolver } from 'src/domains/citation';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
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

  it('没有运行编号的上下文照常写入但不入账；不同运行分开查询', async () => {
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/plain.md', content: 'No run' }, contextFor({ callId: 'n1' }));
    expect(rowCount()).toBe(0);
    await write.run({ locator: 'workspace:/other.md', content: 'Run C' }, contextFor({ runId: 'run-c', callId: 'r1' }));
    expect(changes('run-a').changes).toEqual([]);
    expect(changes().changes.map(change => change.runId)).toEqual(['run-c']);
  });
});
