import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { createProjectLifecycle } from 'src/domains/projects';
import { createDocumentReferenceOperations } from 'src/domains/document-references';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { readActiveWorkspaceSubtreeNodeIds } from 'src/features/workspace/node-deletion';
import { readWorkspaceDeletionReferencePreview } from '..';

let database: DatabaseService;
beforeEach(() => { database = new DatabaseService(':memory:'); database.initialize(); });
afterEach(() => database.close());
describe('Workspace deletion references through real scope and index', () => {
  it('includes unloaded descendants, counts appearances once, excludes simultaneously removed sources, and uses the same deletion scope', () => {
    const db = database.getDb(), workspace = new WorkspaceService(db);
    const projectId = createProjectLifecycle(db).create({ name: 'Deletion' });
    const folder = workspace.createFolder(projectId, 'Folder', null);
    const nested = workspace.createFolder(projectId, 'Unloaded', folder);
    const target = workspace.createDocument(projectId, 'Target.md', nested, 'document');
    const inside = workspace.createDocument(projectId, 'Inside.md', folder, 'document');
    const outside = workspace.createDocument(projectId, 'Outside.md', null, 'document');
    const operations = createDocumentReferenceOperations(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
    db.transaction(() => {
      operations.replace({ sourceDocumentId: inside, references: [{ referenceId: 'inside', targetDocumentId: target, kind: 'inline' }] });
      operations.replace({ sourceDocumentId: outside, references: [{ referenceId: 'a', targetDocumentId: target, kind: 'inline' }, { referenceId: 'b', targetDocumentId: target, kind: 'document-card' }] });
    })();
    expect(readWorkspaceDeletionReferencePreview(db, [folder, target])).toEqual({ referenceCount: 2, referencingDocumentCount: 1, documents: [{ sourceDocumentId: outside, title: 'Outside.md', nodeType: 'document', referenceCount: 2 }] });
    expect(readWorkspaceDeletionReferencePreview(db, [folder, outside]).referenceCount).toBe(0);
    const expected = readActiveWorkspaceSubtreeNodeIds(db, [folder]);
    expect(new Set(workspace.deleteNode(folder))).toEqual(new Set(expected));
    expect(readWorkspaceDeletionReferencePreview(db, [folder]).referenceCount).toBe(0);
  });
  it('does not disclose cross-project or soft-deleted source titles and bounds a large document list while retaining exact counts', () => {
    const db = database.getDb(), workspace = new WorkspaceService(db);
    const projectId = createProjectLifecycle(db).create({ name: 'Current' });
    const other = createProjectLifecycle(db).create({ name: 'Other' });
    const target = workspace.createDocument(projectId, 'Target.md', null, 'document');
    const operations = createDocumentReferenceOperations(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
    const sources = Array.from({ length: 13 }, (_, index) => workspace.createDocument(projectId, `Source ${index}.md`, null, 'document'));
    db.transaction(() => { for (const id of sources) operations.replace({ sourceDocumentId: id, references: [{ referenceId: id, targetDocumentId: target, kind: 'inline' }] }); })();
    db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(other, sources[0]);
    workspace.deleteNode(sources[1]);
    const preview = readWorkspaceDeletionReferencePreview(db, [target]);
    expect(preview.referenceCount).toBe(11); expect(preview.referencingDocumentCount).toBe(11); expect(preview.documents).toHaveLength(10);
    expect(preview.documents.map(source => source.sourceDocumentId)).not.toContain(sources[0]); expect(preview.documents.map(source => source.sourceDocumentId)).not.toContain(sources[1]);
  });
});
