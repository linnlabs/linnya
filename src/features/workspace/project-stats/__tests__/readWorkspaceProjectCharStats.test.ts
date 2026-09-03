import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceProjectCharStats } from '../orchestration/readWorkspaceProjectCharStats';

describe('readWorkspaceProjectCharStats', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE workspace_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        type TEXT NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE document_versions (
        node_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        char_count INTEGER NOT NULL
      );
      INSERT INTO workspace_nodes (id, project_id, type, deleted_at) VALUES
        ('active-doc', 'project-a', 'document', NULL),
        ('deleted-doc', 'project-a', 'document', 100),
        ('other-doc', 'project-b', 'document', NULL);
      INSERT INTO document_versions (node_id, version_number, char_count) VALUES
        ('active-doc', 1, 10),
        ('active-doc', 2, 25),
        ('deleted-doc', 1, 100),
        ('other-doc', 1, 200);
    `);
  });

  afterEach(() => db.close());

  it('只聚合当前项目未删除文档的最新版本', () => {
    expect(readWorkspaceProjectCharStats({ db, projectId: 'project-a' })).toEqual({
      projectId: 'project-a',
      charCount: 25,
    });
  });
});
