import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';
import type { WorkspaceMutationPublisher } from '../../definitions/workspaceMutationPublisher';
import { inspectWorkspaceNodeTransfer } from '../orchestration/inspectWorkspaceNodeTransfer';
import { transferWorkspaceNode } from '../orchestration/transferWorkspaceNode';

let db: Database.Database | null = null;

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_workspace_nodes_active_sibling_name_unique
      ON workspace_nodes(
        COALESCE(project_id, '__global__'),
        COALESCE(parent_id, '__root__'),
        name
      )
      WHERE deleted_at IS NULL;
    CREATE TABLE workspace_vfs_search_lines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      inode TEXT NOT NULL,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      source TEXT NOT NULL,
      content_kind TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      text TEXT NOT NULL,
      text_lc TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      node_updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );
    CREATE TABLE workspace_vfs_search_grams (
      project_id TEXT NOT NULL,
      gram TEXT NOT NULL,
      line_id TEXT NOT NULL,
      PRIMARY KEY(project_id, gram, line_id),
      FOREIGN KEY(line_id) REFERENCES workspace_vfs_search_lines(id) ON DELETE CASCADE
    );
  `);
  database.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-1', '来源');
  database.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-2', '目标');
  return database;
}

function insertNode(params: {
  readonly id: string;
  readonly projectId: string;
  readonly parentId?: string | null;
  readonly type: string;
  readonly name: string;
  readonly deletedAt?: number | null;
}): void {
  db?.prepare(`
    INSERT INTO workspace_nodes (
      id, project_id, parent_id, type, name, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1, ?)
  `).run(
    params.id,
    params.projectId,
    params.parentId ?? null,
    params.type,
    params.name,
    params.deletedAt ?? null,
  );
}

async function flushMutationQueue(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('workspace node cross-project transfer', () => {
  it('moves the complete folder subtree atomically, preserves ids, invalidates source search and publishes one event', async () => {
    db = createDatabase();
    insertNode({ id: 'folder-1', projectId: 'project-1', type: 'folder', name: '资料' });
    insertNode({ id: 'folder-2', projectId: 'project-1', parentId: 'folder-1', type: 'folder', name: '二级' });
    insertNode({ id: 'doc-1', projectId: 'project-1', parentId: 'folder-2', type: 'document', name: '报告.md' });
    insertNode({
      id: 'deleted-doc',
      projectId: 'project-1',
      parentId: 'folder-1',
      type: 'document',
      name: '旧稿.md',
      deletedAt: 10,
    });
    db.prepare(`
      INSERT INTO workspace_vfs_search_lines (
        id, project_id, inode, path, name, node_type, source, content_kind,
        line_no, text, text_lc, content_hash, node_updated_at, indexed_at
      ) VALUES ('line-1', 'project-1', 'workspace:doc-1', '/资料/二级/报告.md',
        '报告.md', 'document', 'workspace_node', 'content', 1, '正文', '正文', 'hash', 1, 1)
    `).run();
    db.prepare(`
      INSERT INTO workspace_vfs_search_grams (project_id, gram, line_id)
      VALUES ('project-1', '正文', 'line-1')
    `).run();

    const events: WorkspaceMutationEvent[] = [];
    const mutationPublisher: WorkspaceMutationPublisher = {
      publish(event) {
        events.push(event);
      },
    };
    const result = transferWorkspaceNode({
      db,
      nodeId: 'folder-1',
      targetProjectId: 'project-2',
      mutationPublisher,
    });

    expect(new Set(result.movedNodeIds)).toEqual(new Set(['folder-1', 'folder-2', 'doc-1']));
    expect(db.prepare(`
      SELECT id, project_id, parent_id, deleted_at
      FROM workspace_nodes ORDER BY id
    `).all()).toEqual([
      { id: 'deleted-doc', project_id: 'project-2', parent_id: 'folder-1', deleted_at: 10 },
      { id: 'doc-1', project_id: 'project-2', parent_id: 'folder-2', deleted_at: null },
      { id: 'folder-1', project_id: 'project-2', parent_id: null, deleted_at: null },
      { id: 'folder-2', project_id: 'project-2', parent_id: 'folder-1', deleted_at: null },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_vfs_search_lines').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_vfs_search_grams').get())
      .toEqual({ count: 0 });

    await flushMutationQueue();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'workspace.node.transferred',
      nodeId: 'folder-1',
      sourceProjectId: 'project-1',
      targetProjectId: 'project-2',
      movedNodeIds: expect.arrayContaining(['folder-1', 'folder-2', 'doc-1']),
    });
  });

  it('rejects a target root name conflict without changing either project', () => {
    const database = createDatabase();
    db = database;
    insertNode({ id: 'source-doc', projectId: 'project-1', type: 'document', name: '报告.md' });
    insertNode({ id: 'target-doc', projectId: 'project-2', type: 'document', name: '报告.md' });

    expect(() => transferWorkspaceNode({
      db: database,
      nodeId: 'source-doc',
      targetProjectId: 'project-2',
    })).toThrow('Workspace sibling name already exists');
    expect(db.prepare('SELECT project_id FROM workspace_nodes WHERE id = ?').get('source-doc'))
      .toEqual({ project_id: 'project-1' });
  });

  it('rejects same-project transfer during both inspection and execution', () => {
    const database = createDatabase();
    db = database;
    insertNode({ id: 'source-doc', projectId: 'project-1', type: 'document', name: '报告.md' });

    expect(() => inspectWorkspaceNodeTransfer({
      db: database,
      nodeId: 'source-doc',
      targetProjectId: 'project-1',
    })).toThrow('already in target project');
    expect(() => transferWorkspaceNode({
      db: database,
      nodeId: 'source-doc',
      targetProjectId: 'project-1',
    })).toThrow('already in target project');
  });

  it('rejects a missing target project and an already-corrupted cross-project subtree', () => {
    const database = createDatabase();
    db = database;
    insertNode({ id: 'folder-1', projectId: 'project-1', type: 'folder', name: '资料' });
    insertNode({
      id: 'foreign-child',
      projectId: 'project-2',
      parentId: 'folder-1',
      type: 'document',
      name: '异常.md',
    });

    expect(() => inspectWorkspaceNodeTransfer({
      db: database,
      nodeId: 'folder-1',
      targetProjectId: 'missing-project',
    })).toThrow('project not found');
    expect(() => inspectWorkspaceNodeTransfer({
      db: database,
      nodeId: 'folder-1',
      targetProjectId: 'project-2',
    })).toThrow('subtree crosses project boundaries');
  });

  it('does not publish a transfer event when an outer transaction rolls back', async () => {
    const database = createDatabase();
    db = database;
    insertNode({ id: 'source-doc', projectId: 'project-1', type: 'document', name: '报告.md' });
    const events: WorkspaceMutationEvent[] = [];
    const transaction = database.transaction(() => {
      transferWorkspaceNode({
        db: database,
        nodeId: 'source-doc',
        targetProjectId: 'project-2',
        mutationPublisher: { publish: (event) => events.push(event) },
      });
      throw new Error('rollback');
    });

    expect(() => transaction.immediate()).toThrow('rollback');
    await flushMutationQueue();
    expect(events).toHaveLength(0);
    expect(database.prepare('SELECT project_id FROM workspace_nodes WHERE id = ?').get('source-doc'))
      .toEqual({ project_id: 'project-1' });
  });
});
