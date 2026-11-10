import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { canvasPluginMigrations } from '../migrations';
import { createCanvasPlainTextDocument } from '../../../shared';
import { commitCanvasOperations, initializeCanvasDocument, readCanvasCommitState } from '../../features/canvasCommit';

it('rolls revision facts back with content and never lowers the floor on later low-revision additions', () => {
  const database = new Database(':memory:');
  const actor = { viewId: 'view', source: { kind: 'user', conversationId: null, runId: null } } as const;
  const operations = [{ op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument('正文') }];
  try {
    database.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('doc')");
    for (const migration of canvasPluginMigrations) migration.up(database);
    initializeCanvasDocument(database, 'doc');
    expect(() => commitCanvasOperations({ database, actor, now: 1, request: { documentId: 'doc', requestId: 'failed', operations }, ports: { participants: [{ commit() { throw new Error('Owner rejected'); } }] } })).toThrow('Owner rejected');
    expect(readCanvasCommitState(database, 'doc')).toMatchObject({ maximumRevision: 0, elements: [] });
    commitCanvasOperations({ database, actor, now: 2, request: { documentId: 'doc', requestId: 'create', operations } });
    commitCanvasOperations({ database, actor, now: 3, request: { documentId: 'doc', requestId: 'edit', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'green' } }] } });
    commitCanvasOperations({ database, actor, now: 4, request: { documentId: 'doc', requestId: 'add-low', operations } });
    expect(readCanvasCommitState(database, 'doc').maximumRevision).toBe(2);
  } finally { database.close(); }
});
