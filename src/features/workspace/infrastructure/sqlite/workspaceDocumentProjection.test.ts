import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { listWorkspaceDocumentIds, readWorkspaceDocumentMetadata, touchWorkspaceDocument, searchWorkspaceDocumentIdentities } from './workspaceDocumentProjection';

it('projects only active document identities and keeps timestamp changes in the caller transaction', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY, project_id TEXT, type TEXT, updated_at INTEGER, deleted_at INTEGER);
      INSERT INTO workspace_nodes VALUES ('a','project','document',1,NULL), ('deleted','project','document',1,2), ('other','other','document',1,NULL);`);
    expect(listWorkspaceDocumentIds(db, { projectId: 'project', nodeType: 'document' })).toEqual(['a']);
    expect(readWorkspaceDocumentMetadata(db, 'a')).toEqual({ projectId: 'project' });
    expect(readWorkspaceDocumentMetadata(db, 'deleted')).toBeNull();
    expect(() => db.transaction(() => { touchWorkspaceDocument(db, 'a', 3); throw new Error('rollback'); })()).toThrow('rollback');
    expect(db.prepare('SELECT updated_at FROM workspace_nodes WHERE id = ?').pluck().get('a')).toBe(1);
    expect(() => touchWorkspaceDocument(db, 'deleted', 3)).toThrow('not found');
  } finally { db.close(); }
});


it('orders reference candidates by real recent-open facts and treats wildcard characters literally', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY, project_id TEXT, type TEXT, name TEXT, updated_at INTEGER, last_opened_at INTEGER, deleted_at INTEGER);
      INSERT INTO workspace_nodes VALUES ('recent','project','document','a%_literal',1,100,NULL),('updated','project','slides','b%_literal',99,NULL,NULL),('old','project','document','c%_literal',2,NULL,NULL),('folder','project','folder','%_',100,1000,NULL),('deleted','project','document','%_',100,1000,1),('other','other','document','%_',100,1000,NULL),('wildcard','project','document','plain',100,1000,NULL);`);
    expect(searchWorkspaceDocumentIdentities(db, { projectId: 'project', keyword: '%_', limit: 20 }).map(row => row.id)).toEqual(['recent','updated','old']);
    expect(searchWorkspaceDocumentIdentities(db, { projectId: 'project', keyword: '%_', limit: 1 }).map(row => row.id)).toEqual(['recent']);
  } finally { db.close(); }
});
