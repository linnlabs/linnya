import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listRecentWorkspaceDocuments,
  notifyWorkspaceDocumentOpened,
} from '../orchestration/workspaceDocumentActivity';

describe('workspace document activity', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE workspace_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        parent_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        last_opened_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO projects (id, name) VALUES ('project-a', '项目 A'), ('project-b', '项目 B');
      INSERT INTO workspace_nodes (
        id, project_id, parent_id, type, name, created_at, updated_at, last_opened_at, access_count
      ) VALUES
        ('doc-a', 'project-a', NULL, 'document', 'A.md', 10, 10, 10, 1),
        ('doc-b', 'project-b', NULL, 'document', 'B.md', 20, 20, 20, 2),
        ('folder-a', 'project-a', NULL, 'folder', '目录', 30, 30, 30, 0);
    `);
  });

  afterEach(() => db.close());

  it('先按项目过滤，再应用最近文档 limit', () => {
    const result = listRecentWorkspaceDocuments({
      db,
      projectId: 'project-a',
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'doc-a', project_name: '项目 A' });
  });

  it('打开文档时原子更新最近时间和访问次数', () => {
    notifyWorkspaceDocumentOpened({ db, nodeId: 'doc-a' });

    expect(db.prepare(`
      SELECT access_count, last_opened_at > 10 AS opened_after_seed
      FROM workspace_nodes
      WHERE id = 'doc-a'
    `).get()).toEqual({ access_count: 2, opened_after_seed: 1 });
  });
});
