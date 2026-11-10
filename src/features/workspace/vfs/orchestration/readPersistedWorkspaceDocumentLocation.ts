import type { WorkspaceVfsDatabase } from '../definitions/workspaceVfsDatabase';
import { getWorkspaceVfsNodeRow, buildWorkspaceNodePath } from '../persistence/workspaceVfsNodeRows';

/** 独立只读消费者只要稳定身份与地址，不需要listing的插件图标/格式展示能力。 */
export function readPersistedWorkspaceDocumentLocation(db: WorkspaceVfsDatabase, nodeId: string) {
  const row = getWorkspaceVfsNodeRow(db, nodeId);
  if (!row) return null;
  return { id: row.id, projectId: row.project_id, path: `workspace:${buildWorkspaceNodePath(db, row)}`, nodeType: row.type };
}
