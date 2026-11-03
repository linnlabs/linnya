import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDocumentBacklinks, createDocumentReferenceOperations, DOCUMENT_REFERENCE_SCHEMAS } from '../../../index';
import { readWorkspaceDocumentIdentity } from 'src/plugin-sdk/backend/workspaceDocumentProjection';

let db: Database.Database;
function operations() { return createDocumentReferenceOperations(db, { read: id => readWorkspaceDocumentIdentity(db, id) }); }
function replace(targetDocumentId = 'target', referenceId = 'inline-1') {
  operations().replace({ sourceDocumentId: 'source', references: [{ referenceId, targetDocumentId, kind: 'inline' }] });
}
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL, deleted_at INTEGER)');
  for (const ddl of DOCUMENT_REFERENCE_SCHEMAS) db.exec(ddl);
  const insert = db.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, NULL)');
  insert.run('source', 'p1', 'Source', 'document');
  insert.run('target', 'p1', 'Target', 'plugin-document');
  insert.run('foreign', 'p2', 'Secret', 'document');
});
afterEach(() => db.close());

describe('document reference business lifecycle', () => {
  it('paginates grouped backlinks without leaking moved/deleted sources or a foreign target', () => {
    const insert = db.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, NULL)');
    insert.run('source2', 'p1', 'Second', 'slides'); insert.run('moved', 'p1', 'Private', 'document'); insert.run('removed', 'p1', 'Deleted', 'document');
    db.transaction(() => {
      operations().replace({ sourceDocumentId: 'source', references: [{ referenceId: 'r1', targetDocumentId: 'target', kind: 'inline' }, { referenceId: 'r2', targetDocumentId: 'target', kind: 'card' }] });
      for (const id of ['source2', 'moved', 'removed']) operations().replace({ sourceDocumentId: id, references: [{ referenceId: id, targetDocumentId: 'target', kind: 'inline' }] });
    }).immediate();
    db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run('p2', 'moved'); db.prepare('UPDATE workspace_nodes SET deleted_at = 1 WHERE id = ?').run('removed');
    const port = { read: (id: string) => readWorkspaceDocumentIdentity(db, id), listBacklinks: operations().listBacklinks };
    const first = readDocumentBacklinks({ projectId: 'p1', documentId: 'target', limit: 1 }, port);
    expect(first).toEqual({ referenceCount: 3, documentCount: 2, documents: [{ sourceDocumentId: 'source', title: 'Source', nodeType: 'document', referenceCount: 2 }], nextOffset: 1 });
    expect(readDocumentBacklinks({ projectId: 'p1', documentId: 'target', offset: 1, limit: 1 }, port)).toMatchObject({ documents: [{ sourceDocumentId: 'source2', nodeType: 'slides', referenceCount: 1 }], nextOffset: null });
    expect(readDocumentBacklinks({ projectId: 'p2', documentId: 'target' }, port)).toEqual({ referenceCount: 0, documentCount: 0, documents: [], nextOffset: null });
    db.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('target'); insert.run('replacement', 'p1', 'Target', 'document');
    expect(readDocumentBacklinks({ projectId: 'p1', documentId: 'replacement' }, port).referenceCount).toBe(0);
  });
  it('joins the caller transaction, preserving old references when any participant fails', () => {
    expect(() => replace()).toThrow('transaction_required');
    db.transaction(() => replace()).immediate();
    expect(() => db.transaction(() => { operations().replace({ sourceDocumentId: 'source', references: [] }); throw new Error('content failed'); }).immediate()).toThrow('content failed');
    expect(operations().listBacklinks('target')).toHaveLength(1);
  });
  it('follows stable identities across rename and moves, without leaking a cross-project title', () => {
    db.transaction(() => replace()).immediate();
    db.prepare('UPDATE workspace_nodes SET name = ?, project_id = ? WHERE id = ?').run('Renamed', 'p2', 'target');
    expect(operations().listBacklinks('target')).toEqual([]);
    expect(operations().resolve({ sourceDocumentId: 'source', targetDocumentId: 'target' })).toEqual({ targetDocumentId: 'target', status: 'outside_project', title: null, nodeType: null });
    db.transaction(() => replace()).immediate();
    db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run('p1', 'target');
    expect(operations().resolve({ sourceDocumentId: 'source', targetDocumentId: 'target' }).title).toBe('Renamed');
  });
  it('rejects newly introduced missing and foreign targets without partially replacing source references', () => {
    db.transaction(() => replace()).immediate();
    expect(() => db.transaction(() => replace('foreign', 'new-foreign')).immediate()).toThrow('outside_project');
    expect(() => db.transaction(() => replace('missing', 'new-missing')).immediate()).toThrow('target_not_found');
    expect(operations().listBacklinks('target')).toHaveLength(1);
  });
  it('rejects silently retargeting an existing reference identity', () => {
    db.transaction(() => replace()).immediate();
    expect(() => db.transaction(() => replace('foreign')).immediate()).toThrow('reference_retargeted');
    expect(operations().listBacklinks('target')).toHaveLength(1);
  });
  it('keeps deleted targets invalid even when another document reuses the title', () => {
    db.transaction(() => replace()).immediate();
    db.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('target');
    db.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, NULL)').run('replacement', 'p1', 'Target', 'document');
    expect(operations().resolve({ sourceDocumentId: 'source', targetDocumentId: 'target' }).status).toBe('deleted');
    expect(operations().listBacklinks('replacement')).toHaveLength(0);
  });
  it('restores exact retained identities after removal without granting new cross-project references', () => {
    db.transaction(() => replace()).immediate(); db.transaction(() => operations().replace({ sourceDocumentId: 'source', references: [] })).immediate();
    db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run('p2', 'target');
    expect(() => db.transaction(() => replace()).immediate()).toThrow('outside_project');
    const references = [{ referenceId: 'inline-1', targetDocumentId: 'target', kind: 'inline' }]; const retainedReferences = [{ referenceId: 'inline-1', targetDocumentId: 'target' }];
    db.transaction(() => operations().replace({ sourceDocumentId: 'source', references }, { retainedReferences })).immediate();
    expect(operations().resolve({ sourceDocumentId: 'source', targetDocumentId: 'target' }).status).toBe('outside_project');
    expect(() => db.transaction(() => operations().replace({ sourceDocumentId: 'source', references: [{ ...references[0], referenceId: 'new' }] }, { retainedReferences })).immediate()).toThrow('outside_project');
  });
  it('keeps deleted retained targets invalid and rejects changing their stable target identity', () => {
    db.transaction(() => replace()).immediate(); db.transaction(() => operations().replace({ sourceDocumentId: 'source', references: [] })).immediate(); db.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('target');
    const retainedReferences = [{ referenceId: 'inline-1', targetDocumentId: 'target' }];
    db.transaction(() => operations().replace({ sourceDocumentId: 'source', references: [{ referenceId: 'inline-1', targetDocumentId: 'target', kind: 'inline' }] }, { retainedReferences })).immediate();
    expect(operations().resolve({ sourceDocumentId: 'source', targetDocumentId: 'target' }).status).toBe('deleted');
    expect(() => db.transaction(() => operations().replace({ sourceDocumentId: 'source', references: [{ referenceId: 'inline-1', targetDocumentId: 'foreign', kind: 'inline' }] }, { retainedReferences })).immediate()).toThrow('reference_retargeted');
  });
  it('excludes soft-deleted sources and restores backlinks after source restoration', () => {
    db.transaction(() => replace()).immediate();
    db.prepare('UPDATE workspace_nodes SET deleted_at = 10 WHERE id = ?').run('source');
    expect(operations().listBacklinks('target')).toHaveLength(0);
    db.prepare('UPDATE workspace_nodes SET deleted_at = NULL WHERE id = ?').run('source');
    expect(operations().listBacklinks('target')).toHaveLength(1);
    db.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('source');
    expect(operations().listBacklinks('target')).toHaveLength(0);
  });
  it('rejects folder identities as either end of a document reference', () => {
    db.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, NULL)').run('folder', 'p1', 'Folder', 'folder');
    expect(() => db.transaction(() => replace('folder', 'new')).immediate()).toThrow('target_not_found');
    expect(() => db.transaction(() => operations().replace({ sourceDocumentId: 'folder', references: [] })).immediate()).toThrow('source_not_found');
  });

});
