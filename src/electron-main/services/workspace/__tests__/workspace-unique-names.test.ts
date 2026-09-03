import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { WorkspaceService } from '../workspace';
import { WorkspaceSiblingNameConflictError } from '../../../../features/workspace/definitions/workspaceErrors';

function createWorkspaceSchema(db: Database.Database): void {
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
}

describe('WorkspaceService sibling name rules', () => {
  it('rejects duplicate names under the same parent', () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const service = new WorkspaceService(db);

    service.createFolder('project-1', '资料');
    expect(() => service.createFolder('project-1', '资料')).toThrow(WorkspaceSiblingNameConflictError);
    try {
      service.createFolder('project-1', '资料');
      throw new Error('Expected duplicate folder creation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceSiblingNameConflictError);
      expect(error).toMatchObject({
        nodeName: '资料',
        projectId: 'project-1',
        parentId: null,
      });
    }

    db.close();
  });

  it('allows same names under different parents and projects', () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const service = new WorkspaceService(db);

    const folderId = service.createFolder('project-1', '文件夹');
    expect(() => service.createDocument('project-1', '报告', folderId)).not.toThrow();
    expect(() => service.createDocument('project-1', '报告', null)).not.toThrow();
    expect(() => service.createDocument('project-2', '报告', null)).not.toThrow();

    db.close();
  });

  it('rejects rename and move operations that would create sibling duplicates', () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const service = new WorkspaceService(db);

    const folderId = service.createFolder('project-1', '文件夹');
    const rootDocId = service.createDocument('project-1', '报告', null);
    const childDocId = service.createDocument('project-1', '报告', folderId);
    const otherDocId = service.createDocument('project-1', '摘要', null);

    expect(() => service.renameNode(otherDocId, '报告')).toThrow(WorkspaceSiblingNameConflictError);
    expect(() => service.moveNode(childDocId, null)).toThrow(WorkspaceSiblingNameConflictError);
    expect(() => service.renameNode(rootDocId, '报告')).not.toThrow();

    db.close();
  });

  it('generates unique sibling names for copies', () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const service = new WorkspaceService(db);

    service.createDocument('project-1', '报告 副本.md', null);
    expect(service.createAvailableSiblingCopyName({
      projectId: 'project-1',
      parentId: null,
      sourceName: '报告.md',
    })).toBe('报告 副本 (1).md');

    db.close();
  });

  it('generates unique sibling names for repeated document creation defaults', () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const service = new WorkspaceService(db);

    service.createDocument('project-1', '场景图.canvas', null, 'plugin-document');
    expect(service.createAvailableSiblingName({
      projectId: 'project-1',
      parentId: null,
      desiredName: '场景图.canvas',
    })).toBe('场景图 (1).canvas');

    db.close();
  });
});
