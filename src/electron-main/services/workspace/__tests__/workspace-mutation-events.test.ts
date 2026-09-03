import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';

import { WorkspaceService } from '../workspace';
import type { WorkspaceMutationPublisher } from '../../../../features/workspace/definitions/workspaceMutationPublisher';

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

async function flushMutationQueue(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createRecordingPublisher(events: WorkspaceMutationEvent[]): WorkspaceMutationPublisher {
  return {
    publish(event) {
      events.push(event);
    },
  };
}

function lastEvent(events: readonly WorkspaceMutationEvent[]): WorkspaceMutationEvent | undefined {
  return events.length > 0 ? events[events.length - 1] : undefined;
}

describe('WorkspaceService mutation events', () => {
  it('publishes node structure mutations after the final database state is visible', async () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const events: WorkspaceMutationEvent[] = [];
    const service = new WorkspaceService(db, {
      mutationPublisher: createRecordingPublisher(events),
    });

    const folderId = service.createFolder('project-1', '资料');
    await flushMutationQueue();
    expect(lastEvent(events)).toMatchObject({
      type: 'workspace.node.created',
      projectId: 'project-1',
      nodeId: folderId,
      nodeType: 'folder',
      parentId: null,
      name: '资料',
    });

    const docId = service.createDocument('project-1', '报告.md', folderId);
    await flushMutationQueue();
    expect(lastEvent(events)).toMatchObject({
      type: 'workspace.node.created',
      projectId: 'project-1',
      nodeId: docId,
      nodeType: 'document',
      parentId: folderId,
      name: '报告.md',
    });

    service.renameNode(docId, '报告终版.md');
    await flushMutationQueue();
    expect(lastEvent(events)).toMatchObject({
      type: 'workspace.node.renamed',
      nodeId: docId,
      parentId: folderId,
      oldName: '报告.md',
      name: '报告终版.md',
    });

    service.moveNode(docId, null);
    await flushMutationQueue();
    expect(lastEvent(events)).toMatchObject({
      type: 'workspace.node.moved',
      nodeId: docId,
      oldParentId: folderId,
      parentId: null,
      name: '报告终版.md',
    });

    service.deleteNode(docId);
    await flushMutationQueue();
    expect(lastEvent(events)).toMatchObject({
      type: 'workspace.node.deleted',
      nodeId: docId,
      parentId: null,
      name: '报告终版.md',
      deletedNodeIds: [docId],
    });

    db.close();
  });

  it('soft-deletes an entire folder subtree and publishes all deleted node ids', async () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const events: WorkspaceMutationEvent[] = [];
    const service = new WorkspaceService(db, {
      mutationPublisher: createRecordingPublisher(events),
    });
    const folderId = service.createFolder('project-1', '资料');
    const nestedFolderId = service.createFolder('project-1', '二级', folderId);
    const docId = service.createDocument('project-1', '报告.md', nestedFolderId);
    await flushMutationQueue();

    const deletedNodeIds = service.deleteNode(folderId);
    await flushMutationQueue();

    expect(new Set(deletedNodeIds)).toEqual(new Set([folderId, nestedFolderId, docId]));
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_nodes WHERE deleted_at IS NULL').get())
      .toEqual({ count: 0 });
    expect(lastEvent(events)).toMatchObject({
      type: 'workspace.node.deleted',
      nodeId: folderId,
      deletedNodeIds: expect.arrayContaining([folderId, nestedFolderId, docId]),
    });
    db.close();
  });

  it('does not publish node.created when an outer transaction rolls back', async () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const events: WorkspaceMutationEvent[] = [];
    const service = new WorkspaceService(db, {
      mutationPublisher: createRecordingPublisher(events),
    });

    const tx = db.transaction(() => {
      service.createDocument('project-1', '会回滚.md');
      throw new Error('rollback');
    });

    expect(() => tx.immediate()).toThrow('rollback');
    await flushMutationQueue();

    expect(service.getChildNodes(null, 'project-1')).toHaveLength(0);
    expect(events).toHaveLength(0);

    db.close();
  });

  it('publishes one node.created after an outer transaction commits', async () => {
    const db = new Database(':memory:');
    createWorkspaceSchema(db);
    const events: WorkspaceMutationEvent[] = [];
    const service = new WorkspaceService(db, {
      mutationPublisher: createRecordingPublisher(events),
    });

    let documentId = '';
    const tx = db.transaction(() => {
      documentId = service.createDocument('project-1', '事务内插件文档.sheet', null, 'sheet');
    });

    tx.immediate();
    expect(events).toHaveLength(0);

    await flushMutationQueue();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'workspace.node.created',
      projectId: 'project-1',
      nodeId: documentId,
      nodeType: 'sheet',
      parentId: null,
      name: '事务内插件文档.sheet',
    });

    db.close();
  });
});
