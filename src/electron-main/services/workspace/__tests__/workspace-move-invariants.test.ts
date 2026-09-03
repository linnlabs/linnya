import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../workspace';

let db: Database.Database | null = null;

function createService(): WorkspaceService {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      last_opened_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    )
  `);
  return new WorkspaceService(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('WorkspaceService move invariants', () => {
  it('rejects a missing parent, document parent and parent from another project', () => {
    const service = createService();
    const documentId = service.createDocument('project-1', '报告.md');
    const otherDocumentId = service.createDocument('project-1', '说明.md');
    const otherProjectFolderId = service.createFolder('project-2', '资料');

    expect(() => service.moveNode(documentId, 'missing')).toThrow('parent not found');
    expect(() => service.moveNode(documentId, otherDocumentId)).toThrow('parent is not a folder');
    expect(() => service.moveNode(documentId, otherProjectFolderId)).toThrow('belongs to another project');
    expect(service.getNode(documentId)?.parent_id).toBeNull();
  });

  it('rejects moving a folder into itself or its descendant', () => {
    const service = createService();
    const rootId = service.createFolder('project-1', '根');
    const childId = service.createFolder('project-1', '子目录', rootId);

    expect(() => service.moveNode(rootId, rootId)).toThrow('cannot move into itself');
    expect(() => service.moveNode(rootId, childId)).toThrow('cannot move into itself');
    expect(service.getNode(rootId)?.parent_id).toBeNull();
  });
});
