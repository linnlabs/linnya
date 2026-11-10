import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { DOCUMENT_REFERENCE_SCHEMAS } from 'src/domains/document-references';
import { createDocumentReferenceMarkdownRuntime, listDocumentBacklinks } from '@plugin/backend/documentReferences';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { createCanvasDocumentCommitParticipants } from '../../../adapters/createCanvasDocumentCommitParticipants';

it('移动/染色不重写关系，修改标签与重复身份拒绝仍和正文一起提交或回滚', () => {
  const database = new Database(':memory:');
  const references = createDocumentReferenceMarkdownRuntime(database);
  try {
    for (const ddl of [...CORE_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS]) database.exec(ddl);
    for (const migration of canvasPluginMigrations) migration.up(database);
    database.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,?,1,1)').run('project', 'Project');
    const insert = database.prepare('INSERT INTO workspace_nodes(id,project_id,name,type,created_at,updated_at) VALUES (?,?,?,?,1,1)');
    insert.run('doc', 'project', 'Canvas', 'canvas'); insert.run('target', 'project', 'Target', 'document');
    initializeCanvasDocument(database, 'doc');
    const admission = createCanvasDocumentCommitParticipants(database, references);
    const history = createCanvasHistoryRuntime({ database, ports: { participants: admission.participants } });
    const actor = { source: { kind: 'user' as const, conversationId: null, runId: null }, viewId: 'view' };
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'documentReference', attrs: { documentId: 'target', referenceId: 'ref-1' } }] }] };
    history.commit({ actor, now: 1, request: { documentId: 'doc', requestId: 'add', operations: [{ op: 'addText', width: 240, height: 120, content }] } });
    const queries = vi.spyOn(database, 'prepare');
    history.commit({ actor, now: 2, request: { documentId: 'doc', requestId: 'move', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { x: 90, color: 'yellow' } }] } });
    expect(queries.mock.calls.some(([sql]) => sql.includes('document_references'))).toBe(false); queries.mockRestore();
    expect(listDocumentBacklinks(database, 'target')).toHaveLength(1);
    const before = readCanvasSnapshot(database, 'doc');
    const duplicate = { type: 'doc', content: [...content.content, ...content.content] };
    expect(() => history.commit({ actor, now: 3, request: { documentId: 'doc', requestId: 'duplicate', operations: [{ op: 'update', id: 'c1', baseRevision: 2, patch: { data: { contentVersion: 1, content: duplicate } } }] } })).toThrow('duplicate_reference');
    expect(readCanvasSnapshot(database, 'doc')).toEqual(before);
    history.commit({ actor, now: 4, request: { documentId: 'doc', requestId: 'delete', operations: [{ op: 'delete', id: 'c1' }] } });
    expect(listDocumentBacklinks(database, 'target')).toHaveLength(0);
  } finally { references.dispose(); database.close(); }
});
