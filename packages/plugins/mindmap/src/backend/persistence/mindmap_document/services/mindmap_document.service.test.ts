import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { PluginWorkspaceDocumentUpdatedPayload } from '@plugin/backend/workspaceRuntime';
import { WorkspaceService } from '@plugin/backend/workspaceRuntime';
import { MindMapDocumentService } from './mindmap_document.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readCount(db: Database.Database, tableName: 'workspace_nodes' | 'mindmap_versions'): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  if (!isRecord(row) || typeof row.count !== 'number') {
    throw new Error(`测试数据库计数结构异常：${tableName}`);
  }
  return row.count;
}

function installMindmapDocumentTables(db: Database.Database, options: {
  readonly includeTextSnapshotTable: boolean;
}): void {
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
    );

    CREATE TABLE mindmap_versions (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      root_topic TEXT,
      theme_name TEXT,
      layout_type INTEGER,
      node_count INTEGER,
      char_count INTEGER,
      viewport_x REAL,
      viewport_y REAL,
      viewport_scale REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  if (options.includeTextSnapshotTable) {
    db.exec(`
      CREATE TABLE workspace_node_text_snapshots (
        node_id TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        text TEXT NOT NULL,
        source_plugin_id TEXT,
        source_node_type TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  }
}

async function flushWorkspaceMutationPublish(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MindMapDocumentService text snapshot transaction', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('创建文档时同步写入 host 文本快照', () => {
    db = new Database(':memory:');
    installMindmapDocumentTables(db, { includeTextSnapshotTable: true });
    const service = new MindMapDocumentService(db, new WorkspaceService(db));

    const node = service.createDocument({
      projectId: 'project-1',
      parentId: null,
      name: '策略拆解',
    });

    const snapshot = db.prepare(`
      SELECT content_type, text, source_plugin_id, source_node_type
      FROM workspace_node_text_snapshots
      WHERE node_id = ?
    `).get(node.id);

    expect(isRecord(snapshot)).toBe(true);
    if (!isRecord(snapshot)) return;
    expect(snapshot.content_type).toBe('text/markdown');
    expect(snapshot.source_plugin_id).toBe('mindmap');
    expect(snapshot.source_node_type).toBe('mindmap');
    expect(snapshot.text).toContain('策略拆解');
  });

  it('创建和更新版本提交后发布 document.updated', async () => {
    db = new Database(':memory:');
    installMindmapDocumentTables(db, { includeTextSnapshotTable: true });
    const published: PluginWorkspaceDocumentUpdatedPayload[] = [];
    const service = new MindMapDocumentService(db, new WorkspaceService(db), {
      publishDocumentUpdated: (payload) => published.push(payload),
    });

    const node = service.createDocument({
      projectId: 'project-mindmap',
      parentId: null,
      name: '策略拆解',
    });
    await flushWorkspaceMutationPublish();

    expect(published).toEqual([
      {
        projectId: 'project-mindmap',
        documentId: node.id,
        nodeType: 'mindmap',
        mutationKind: 'version',
        versionNumber: 1,
      },
    ]);

    published.length = 0;
    service.updateDocument({
      documentId: node.id,
      expectedBaseVersionNumber: 1,
      content: {
        nodeData: {
          id: 'root',
          topic: '策略拆解 V2',
          root: true,
          children: [],
        },
        arrows: [],
        summaries: [],
        direction: 1,
      },
    });
    await flushWorkspaceMutationPublish();

    expect(published).toEqual([
      {
        projectId: 'project-mindmap',
        documentId: node.id,
        nodeType: 'mindmap',
        mutationKind: 'version',
        versionNumber: 2,
      },
    ]);
  });

  it('快照写入失败时回滚 workspace 节点和首个结构版本', () => {
    db = new Database(':memory:');
    installMindmapDocumentTables(db, { includeTextSnapshotTable: false });
    const service = new MindMapDocumentService(db, new WorkspaceService(db));

    expect(() => service.createDocument({
      projectId: 'project-1',
      parentId: null,
      name: '失败导图',
    })).toThrow();

    expect(readCount(db, 'workspace_nodes')).toBe(0);
    expect(readCount(db, 'mindmap_versions')).toBe(0);
  });

  it('创建事务回滚后不发布 document.updated', async () => {
    db = new Database(':memory:');
    installMindmapDocumentTables(db, { includeTextSnapshotTable: false });
    const published: PluginWorkspaceDocumentUpdatedPayload[] = [];
    const service = new MindMapDocumentService(db, new WorkspaceService(db), {
      publishDocumentUpdated: (payload) => published.push(payload),
    });

    expect(() => service.createDocument({
      projectId: 'project-rollback',
      parentId: null,
      name: '失败导图',
    })).toThrow();

    await flushWorkspaceMutationPublish();
    expect(published).toEqual([]);
  });
});
