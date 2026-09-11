/**
 * @file listWorkspaceVfsNodes.ts
 * @description 列出逻辑 Workspace 数据库中的项目节点和 system views。
 *
 * 资源库、AI 生成图片和会话附件不属于项目文档命名空间，因此不在这里
 * 合成虚拟节点。它们仍可由各自正式领域按资产/对话产物合同读取。
 */

import { findFormatOwnershipByNodeType } from '../../../../app-hosts/linnya/plugin-registry/formatOwnershipCatalog';
import type { WorkspaceNodeRow, WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import { hasResourceLibraryRole } from '../functions/resourceLibraryRole';
import {
  isSystemByInodeFolderId,
  isSystemRootFolderId,
  isSystemViewsFolderId,
  tryParseSystemInodeEntryFolderId,
} from '../functions/virtualNodeIds';
import {
  buildSystemRootNode,
  listSystemByInodeEntries,
  listSystemInodeFiles,
  listSystemRootNodes,
  listSystemViewsNodes,
} from '../functions/systemViewNodes';

export interface WorkspaceVfsNodeTypeAccessPolicy {
  readonly canReadContent: (nodeType: string | null | undefined) => boolean;
  readonly buildDisabledMessage: (nodeType: string, action: string) => string;
}

export const ALLOW_ALL_WORKSPACE_VFS_NODE_TYPES: WorkspaceVfsNodeTypeAccessPolicy = {
  canReadContent: () => true,
  buildDisabledMessage: (nodeType, action) =>
    `当前不能${action} ${nodeType} 类型的 Workspace 节点。`,
};

export interface ListWorkspaceVfsNodesParams {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly parentId?: string | null;
  readonly conversationId?: string | null;
  readonly instanceId?: string | null;
  /** @deprecated 资源库 VFS 投影已删除，保留字段仅用于调用方逐步收敛。 */
  readonly generatedImagesDir?: string;
  readonly includeSystemNodes?: boolean;
  readonly nodeTypeAccessPolicy?: WorkspaceVfsNodeTypeAccessPolicy;
}

export interface WorkspaceVfsStatement {
  all(...params: readonly unknown[]): unknown[];
  get(...params: readonly unknown[]): unknown;
  run(...params: readonly unknown[]): unknown;
}

export interface WorkspaceVfsDatabase {
  prepare(sql: string): WorkspaceVfsStatement;
}

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!trimmed) throw new Error('projectId is required');
  return trimmed;
}

function deriveWorkspaceNodeDisplayName(row: WorkspaceNodeRow): string | null {
  const ownership = findFormatOwnershipByNodeType(row.type);
  const extension = ownership?.extension;
  if (!extension || !row.name.toLowerCase().endsWith(extension)) return null;
  const withoutExtension = row.name.slice(0, -extension.length).trim();
  // 中文说明：display_name 只服务 UI 展示；VFS name/path 仍保留协议名，避免破坏工具按后缀定位文件。
  return withoutExtension.length > 0 ? withoutExtension : null;
}

function toVfsWorkspaceNode(row: WorkspaceNodeRow, pathValue: string): WorkspaceVfsNode {
  const displayName = deriveWorkspaceNodeDisplayName(row);
  return {
    id: row.id,
    inode: `workspace:${row.id}`,
    path: pathValue,
    project_id: row.project_id,
    parent_id: row.parent_id,
    type: row.type as WorkspaceVfsNode['type'],
    name: row.name,
    ...(displayName ? { display_name: displayName } : {}),
    icon: row.icon,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    last_opened_at: row.last_opened_at,
    access_count: row.access_count,
    tags: row.tags,
    is_virtual: false,
    source: 'workspace_node',
  };
}

function isVisibleWorkspaceNode(row: WorkspaceNodeRow): boolean {
  // 资源库及其历史子树是技术投影，不再作为项目文档命名空间暴露。
  return !hasResourceLibraryRole(row.tags);
}

function getChildRows(
  db: WorkspaceVfsDatabase,
  projectId: string,
  parentId: string | null
): WorkspaceNodeRow[] {
  const query =
    parentId === null
      ? `
      SELECT * FROM workspace_nodes
      WHERE parent_id IS NULL AND project_id = ? AND deleted_at IS NULL
      ORDER BY type DESC, name ASC
    `
      : `
      SELECT * FROM workspace_nodes
      WHERE parent_id = ? AND project_id = ? AND deleted_at IS NULL
      ORDER BY type DESC, name ASC
    `;
  return (
    parentId === null
      ? db.prepare(query).all(projectId)
      : db.prepare(query).all(parentId, projectId)
  ) as WorkspaceNodeRow[];
}

function getNodeById(db: WorkspaceVfsDatabase, nodeId: string): WorkspaceNodeRow | null {
  const row = db
    .prepare(
      `
    SELECT * FROM workspace_nodes
    WHERE id = ? AND deleted_at IS NULL
  `
    )
    .get(nodeId) as WorkspaceNodeRow | undefined;
  return row ?? null;
}

function buildWorkspaceNodePath(db: WorkspaceVfsDatabase, row: WorkspaceNodeRow): string {
  const segments = [row.name];
  let parentId = row.parent_id;
  const visited = new Set<string>([row.id]);
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = getNodeById(db, parentId);
    if (!parent) break;
    segments.unshift(parent.name);
    parentId = parent.parent_id;
  }
  return `/${segments.join('/')}`;
}

/** 同步 owner 事务内读取刚提交的节点身份；不遍历系统虚拟视图。 */
export function readPersistedWorkspaceVfsNode(
  db: WorkspaceVfsDatabase,
  nodeId: string
): WorkspaceVfsNode | null {
  const row = getNodeById(db, nodeId);
  return row && isVisibleWorkspaceNode(row)
    ? toVfsWorkspaceNode(row, buildWorkspaceNodePath(db, row))
    : null;
}

export async function listWorkspaceVfsNodes(
  params: ListWorkspaceVfsNodesParams
): Promise<WorkspaceVfsNode[]> {
  const projectId = normalizeProjectId(params.projectId);
  const parentId = params.parentId ?? null;
  const timestamp = Date.now();

  if (parentId === null) {
    const rootNodes = getChildRows(params.db, projectId, null)
      .filter(isVisibleWorkspaceNode)
      .map(row => toVfsWorkspaceNode(row, buildWorkspaceNodePath(params.db, row)));
    if (!params.includeSystemNodes) return rootNodes;
    return [...rootNodes, buildSystemRootNode(projectId, timestamp)];
  }

  if (isSystemRootFolderId(projectId, parentId)) {
    return listSystemRootNodes(projectId, timestamp);
  }
  if (isSystemViewsFolderId(projectId, parentId)) {
    return listSystemViewsNodes(projectId, timestamp);
  }
  if (isSystemByInodeFolderId(projectId, parentId)) {
    return listSystemByInodeEntries({ db: params.db, projectId });
  }

  const systemEntryWorkspaceNodeId = tryParseSystemInodeEntryFolderId(projectId, parentId);
  if (systemEntryWorkspaceNodeId) {
    const workspaceRow = getNodeById(params.db, systemEntryWorkspaceNodeId);
    if (!workspaceRow) return [];
    return listSystemInodeFiles({ projectId, parentId, workspaceRow });
  }

  const parentRow = getNodeById(params.db, parentId);
  if (parentRow && hasResourceLibraryRole(parentRow.tags)) return [];

  return getChildRows(params.db, projectId, parentId)
    .filter(isVisibleWorkspaceNode)
    .map(row => toVfsWorkspaceNode(row, buildWorkspaceNodePath(params.db, row)));
}
