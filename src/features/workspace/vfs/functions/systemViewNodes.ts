/**
 * @file systemViewNodes.ts
 * @description 构造 `.linnya` 只读系统视图节点。
 */

import type { WorkspaceNodeRow, WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import {
  buildSystemByInodeFolderId,
  buildSystemInodeEntryFolderId,
  buildSystemInodeFileId,
  buildSystemProtocolFileId,
  buildSystemRootFolderId,
  buildSystemViewsFolderId,
} from './virtualNodeIds';
import {
  getDocumentTypeBackendHook,
  listDocumentTypeBackendSystemViewSpecs,
  listDocumentTypeBackendHooks,
} from '@plugin/backend/documentTypeBackendHook';

interface SystemViewDatabase {
  prepare(sql: string): {
    all(...params: readonly unknown[]): unknown[];
  };
}

function buildSyntheticSystemFolder(params: {
  readonly id: string;
  readonly projectId: string;
  readonly parentId: string;
  readonly name: string;
  readonly path: string;
  readonly updatedAt: number;
  readonly payload?: WorkspaceVfsNode['payload'];
}): WorkspaceVfsNode {
  return {
    id: params.id,
    inode: params.id,
    path: params.path,
    project_id: params.projectId,
    parent_id: params.parentId,
    type: 'folder',
    name: params.name,
    icon: null,
    created_at: params.updatedAt,
    updated_at: params.updatedAt,
    deleted_at: null,
    last_opened_at: null,
    access_count: 0,
    tags: null,
    is_virtual: true,
    source: 'system_view',
    payload: params.payload,
  };
}

function buildSyntheticSystemFile(params: {
  readonly id: string;
  readonly projectId: string;
  readonly parentId: string;
  readonly name: string;
  readonly path: string;
  readonly updatedAt: number;
  readonly payload?: WorkspaceVfsNode['payload'];
}): WorkspaceVfsNode {
  return {
    id: params.id,
    inode: params.id,
    path: params.path,
    project_id: params.projectId,
    parent_id: params.parentId,
    type: 'system_file',
    name: params.name,
    icon: null,
    created_at: params.updatedAt,
    updated_at: params.updatedAt,
    deleted_at: null,
    last_opened_at: null,
    access_count: 0,
    tags: null,
    is_virtual: true,
    source: 'system_view',
    payload: params.payload,
  };
}

function getProjectFileRows(db: SystemViewDatabase, projectId: string): WorkspaceNodeRow[] {
  const pluginDocTypes = listDocumentTypeBackendHooks({ includeDisabled: true })
    .map((hook) => hook.docType);
  const documentTypes = Array.from(new Set(['document', ...pluginDocTypes]));
  const placeholders = documentTypes.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM workspace_nodes
    WHERE project_id = ? AND type IN (${placeholders}) AND deleted_at IS NULL
    ORDER BY type ASC, name ASC
  `).all(projectId, ...documentTypes) as WorkspaceNodeRow[];
}

export function getSystemInodeFileSpecs(row: WorkspaceNodeRow): Array<{ readonly name: string; readonly viewKind: string }> {
  if (row.type === 'document') {
    return [{ name: 'content.md', viewKind: 'document_content' }];
  }
  const hook = getDocumentTypeBackendHook(row.type, { includeDisabled: true });
  if (hook) return listDocumentTypeBackendSystemViewSpecs(hook);
  return [];
}

export function buildSystemRootNode(projectId: string, timestamp: number): WorkspaceVfsNode {
  return buildSyntheticSystemFolder({
    id: buildSystemRootFolderId(projectId),
    projectId,
    parentId: 'root',
    name: '.linnya',
    path: '/.linnya',
    updatedAt: timestamp,
  });
}

export function listSystemRootNodes(projectId: string, timestamp: number): WorkspaceVfsNode[] {
  const rootId = buildSystemRootFolderId(projectId);
  return [
    buildSyntheticSystemFolder({
      id: buildSystemViewsFolderId(projectId),
      projectId,
      parentId: rootId,
      name: 'views',
      path: '/.linnya/views',
      updatedAt: timestamp,
    }),
    buildSyntheticSystemFile({
      id: buildSystemProtocolFileId(projectId),
      projectId,
      parentId: rootId,
      name: 'protocol.md',
      path: '/.linnya/protocol.md',
      updatedAt: timestamp,
      payload: { viewKind: 'protocol' },
    }),
  ];
}

export function listSystemViewsNodes(projectId: string, timestamp: number): WorkspaceVfsNode[] {
  const viewsId = buildSystemViewsFolderId(projectId);
  return [
    buildSyntheticSystemFolder({
      id: buildSystemByInodeFolderId(projectId),
      projectId,
      parentId: viewsId,
      name: 'by-inode',
      path: '/.linnya/views/by-inode',
      updatedAt: timestamp,
    }),
  ];
}

export function listSystemByInodeEntries(params: {
  readonly db: SystemViewDatabase;
  readonly projectId: string;
}): WorkspaceVfsNode[] {
  return getProjectFileRows(params.db, params.projectId).map((row) =>
    buildSyntheticSystemFolder({
      id: buildSystemInodeEntryFolderId({ projectId: params.projectId, workspaceNodeId: row.id }),
      projectId: params.projectId,
      parentId: buildSystemByInodeFolderId(params.projectId),
      name: `workspace:${row.id}`,
      path: `/.linnya/views/by-inode/workspace:${row.id}`,
      updatedAt: row.updated_at,
      payload: {
        viewKind: 'inode_entry',
        workspaceNodeId: row.id,
        workspaceNodeType: row.type,
      },
    })
  );
}

export function listSystemInodeFiles(params: {
  readonly projectId: string;
  readonly parentId: string;
  readonly workspaceRow: WorkspaceNodeRow;
}): WorkspaceVfsNode[] {
  return getSystemInodeFileSpecs(params.workspaceRow).map((spec) =>
    buildSyntheticSystemFile({
      id: buildSystemInodeFileId({
        projectId: params.projectId,
        workspaceNodeId: params.workspaceRow.id,
        viewKind: spec.viewKind,
      }),
      projectId: params.projectId,
      parentId: params.parentId,
      name: spec.name,
      path: `/.linnya/views/by-inode/workspace:${params.workspaceRow.id}/${spec.name}`,
      updatedAt: params.workspaceRow.updated_at,
      payload: {
        viewKind: spec.viewKind,
        workspaceNodeId: params.workspaceRow.id,
        workspaceNodeType: params.workspaceRow.type,
      },
    })
  );
}
