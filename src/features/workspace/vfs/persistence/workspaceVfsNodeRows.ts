import type { WorkspaceVfsDatabase } from '../definitions/workspaceVfsDatabase';
import { WorkspaceNodeRowSchema, type WorkspaceNodeRow } from '../definitions/workspaceVfsNode';

export function getWorkspaceVfsNodeRow(db: WorkspaceVfsDatabase, nodeId: string): WorkspaceNodeRow | null {
  const row = db.prepare('SELECT * FROM workspace_nodes WHERE id = ? AND deleted_at IS NULL').get(nodeId);
  return row === undefined ? null : WorkspaceNodeRowSchema.parse(row);
}

/** 持久父链只读投影，不装配system views、文档正文或插件注册表。 */
export function buildWorkspaceNodePath(db: WorkspaceVfsDatabase, row: WorkspaceNodeRow): string {
  const segments = [row.name];
  let parentId = row.parent_id;
  const visited = new Set<string>([row.id]);
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = getWorkspaceVfsNodeRow(db, parentId);
    if (!parent) break;
    segments.unshift(parent.name); parentId = parent.parent_id;
  }
  return `/${segments.join('/')}`;
}
