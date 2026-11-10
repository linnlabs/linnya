import Database from 'better-sqlite3';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { describe, expect, it } from 'vitest';
import { queryDocumentReferenceCandidates, readDocumentReferencePresentation, type ReferenceQueryPort } from '../../../index';
import { readWorkspaceDocumentIdentity, readWorkspaceDocumentLocation, searchWorkspaceDocumentIdentities } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';

describe('document reference candidate and title lifecycle', () => {
  it('searches literal names in one project, follows rename, redacts moved/deleted targets and preserves plugin snapshots', () => {
    const database = new Database(':memory:');
    try {
      for (const ddl of CORE_SCHEMAS) database.exec(ddl);
      for (const id of ['project', 'other', 'other-project']) database.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,?,1,1)').run(id, id);
      const insert = database.prepare('INSERT INTO workspace_nodes(id, project_id, name, type, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)');
      insert.run('doc', 'project', '100%_Example', 'document', null); insert.run('other', 'other', '100%_Secret', 'document', null); insert.run('folder', 'project', '100%_Folder', 'folder', null); insert.run('deleted', 'project', '100%_Deleted', 'document', 1); insert.run('plugin', 'project', 'Slides', 'slides', null);
      const port: ReferenceQueryPort = { read: id => readWorkspaceDocumentIdentity(database, id), location: id => readWorkspaceDocumentLocation(database, id), search: input => searchWorkspaceDocumentIdentities(database, input).map(node => ({ id: node.id, projectId: node.project_id, name: node.name, nodeType: node.type })), isDocumentTypeAvailable: type => type === 'document' };
      expect(queryDocumentReferenceCandidates({ projectId: 'project', keyword: '%_' }, port).map(node => node.documentId)).toEqual(['doc']);
      expect(readDocumentReferencePresentation({ projectId: 'project', documentId: 'plugin' }, port)).toMatchObject({ status: 'plugin_unavailable', title: 'Slides' });
      database.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Renamed', 'doc'); expect(readDocumentReferencePresentation({ projectId: 'project', documentId: 'doc' }, port)).toMatchObject({ title: 'Renamed', path: 'workspace:/Renamed' });
      database.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run('other', 'doc'); expect(readDocumentReferencePresentation({ projectId: 'project', documentId: 'doc' }, port)).toMatchObject({ status: 'outside_project', title: null, path: null });
      database.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('doc'); expect(readDocumentReferencePresentation({ projectId: 'project', documentId: 'doc' }, port).status).toBe('deleted');
    } finally { database.close(); }
  });
});
