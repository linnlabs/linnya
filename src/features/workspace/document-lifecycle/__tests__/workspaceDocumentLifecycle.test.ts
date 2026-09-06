import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';
import { DatabaseService } from '../../../../electron-main/services/database';
import { WorkspaceService } from '../../../../electron-main/services/workspace/workspace';
import { CORE_SCHEMAS } from '../../infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from '../../infrastructure/sqlite/schemas/node-text-snapshot.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { createWorkspaceDocument } from '../orchestration/createWorkspaceDocument';
import { duplicateWorkspaceDocument } from '../orchestration/duplicateWorkspaceDocument';
import { createWorkspaceDocumentLifecycleProviderResolver } from '../../../../app-hosts/linnya/adapters/document-lifecycle/createWorkspaceDocumentLifecycleProviderResolver';
import type { WorkspaceMutationPublisher } from '../../definitions/workspaceMutationPublisher';

type SchemaSet = 'core' | 'markdown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNumberColumn(row: unknown, column: string): number {
  if (!isRecord(row)) {
    throw new Error(`Expected row object when reading ${column}`);
  }
  const value = Reflect.get(row, column);
  if (typeof value !== 'number') {
    throw new Error(`Expected numeric column ${column}`);
  }
  return value;
}

function createDb(schemaSet: SchemaSet): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const statements =
    schemaSet === 'core'
      ? CORE_SCHEMAS
      : [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...MARKDOWN_DOCUMENT_SCHEMAS];

  for (const statement of statements) {
    db.exec(statement);
  }
  return db;
}

function createDatabaseService(db?: Database.Database): DatabaseService {
  if (!db) return new DatabaseService(':memory:');
  return {
    getDb: () => db,
  } as DatabaseService;
}

function createRecordingPublisher(events: WorkspaceMutationEvent[]): WorkspaceMutationPublisher {
  return {
    publish(event) {
      events.push(event);
    },
  };
}

function createLifecycleRuntime(
  db: Database.Database,
  mutationPublisher?: WorkspaceMutationPublisher,
) {
  const databaseService = createDatabaseService(db);
  const workspace = new WorkspaceService(db, { mutationPublisher });
  return {
    workspace,
    resolveProvider: createWorkspaceDocumentLifecycleProviderResolver({
      db,
      databaseService,
      workspaceService: workspace,
    }),
  };
}

async function flushMutationQueue(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createProject(db: Database.Database, name = '测试项目'): string {
  return new WorkspaceService(db).createProject(name);
}

function countActiveNodesByName(db: Database.Database, name: string): number {
  return readNumberColumn(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM workspace_nodes
      WHERE name = ? AND deleted_at IS NULL
    `).get(name),
    'count',
  );
}

function countActiveNodes(db: Database.Database): number {
  return readNumberColumn(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM workspace_nodes
      WHERE deleted_at IS NULL
    `).get(),
    'count',
  );
}

function countDocumentVersions(db: Database.Database, nodeId: string): number {
  return readNumberColumn(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM document_versions
      WHERE node_id = ?
    `).get(nodeId),
    'count',
  );
}

describe('workspace document lifecycle orchestration', () => {

  it('creates markdown document node and initial content in one use case', async () => {
    const db = createDb('markdown');
    try {
      const projectId = createProject(db);

      const result = await createWorkspaceDocument({
        ...createLifecycleRuntime(db),
        projectId,
        parentId: null,
        name: '文档',
        rawType: 'document',
      });

      expect(countActiveNodesByName(db, '文档')).toBe(1);
      expect(countDocumentVersions(db, result.documentId)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('publishes one node.created event after markdown document transaction commits', async () => {
    const db = createDb('markdown');
    try {
      const projectId = createProject(db);
      const events: WorkspaceMutationEvent[] = [];

      const result = await createWorkspaceDocument({
        ...createLifecycleRuntime(db, createRecordingPublisher(events)),
        projectId,
        parentId: null,
        name: '事务文档',
        rawType: 'document',
      });

      await flushMutationQueue();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'workspace.node.created',
        projectId,
        nodeId: result.documentId,
        nodeType: 'document',
        parentId: null,
        name: '事务文档',
      });
      expect(countDocumentVersions(db, result.documentId)).toBe(1);
    } finally {
      db.close();
    }
  });


  it('rolls back markdown node creation when initial content insert fails', async () => {
    const db = createDb('core');
    try {
      const projectId = createProject(db);

      await expect(createWorkspaceDocument({
        ...createLifecycleRuntime(db),
        projectId,
        parentId: null,
        name: '半成品文档',
        rawType: 'document',
      })).rejects.toThrow();

      expect(countActiveNodesByName(db, '半成品文档')).toBe(0);
    } finally {
      db.close();
    }
  });


  it('duplicates markdown content atomically', async () => {
    const db = createDb('markdown');
    try {
      const projectId = createProject(db);
      const source = await createWorkspaceDocument({
        ...createLifecycleRuntime(db),
        projectId,
        parentId: null,
        name: '源文档',
        rawType: 'document',
      });

      const result = await duplicateWorkspaceDocument({
        ...createLifecycleRuntime(db),
        nodeId: source.documentId,
      });

      expect(countActiveNodesByName(db, '源文档 副本')).toBe(1);
      expect(countDocumentVersions(db, result.nodeId)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('rolls back duplicated markdown node when source content is missing', async () => {
    const db = createDb('markdown');
    try {
      const projectId = createProject(db);
      const sourceNodeId = new WorkspaceService(db).createDocument(
        projectId,
        '只有节点没有内容',
        null,
        'document',
      );

      await expect(duplicateWorkspaceDocument({
        ...createLifecycleRuntime(db),
        nodeId: sourceNodeId,
      })).rejects.toThrow();

      expect(countActiveNodes(db)).toBe(1);
      expect(countActiveNodesByName(db, '只有节点没有内容 副本')).toBe(0);
    } finally {
      db.close();
    }
  });


  it('keeps existing markdown content through duplicate', async () => {
    const db = createDb('markdown');
    try {
      const projectId = createProject(db);
      const source = await createWorkspaceDocument({
        ...createLifecycleRuntime(db),
        projectId,
        parentId: null,
        name: '有内容的文档',
        rawType: 'document',
      });
      new MarkdownDocumentService(db).saveNewVersion(
        source.documentId,
        JSON.stringify({
          type: 'doc',
          content: [{
            type: 'rootBlock',
            attrs: { id: 'root-duplicate-source' },
            content: [{
              type: 'baseBlock',
              attrs: { id: 'block-duplicate-source' },
              content: [{ type: 'text', text: 'hello' }],
            }],
          }],
        }),
      );

      const result = await duplicateWorkspaceDocument({
        ...createLifecycleRuntime(db),
        nodeId: source.documentId,
      });

      const copied = new MarkdownDocumentService(db).getDocument(result.nodeId);
      expect(copied).toEqual({
        type: 'doc',
        content: [{
          type: 'rootBlock',
          attrs: expect.objectContaining({ id: 'root-duplicate-source' }),
          content: [{
            type: 'baseBlock',
            attrs: expect.objectContaining({ id: 'block-duplicate-source' }),
            content: [{ type: 'text', text: 'hello' }],
          }],
        }],
      });
    } finally {
      db.close();
    }
  });
});
