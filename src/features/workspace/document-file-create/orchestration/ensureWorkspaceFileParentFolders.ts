import type {
  WorkspaceFileParentFolderPort,
  WorkspaceFileParentFolders,
} from '../definitions/workspaceFileParentFolders';
import type { WorkspaceCreatedFileIdentity } from '../definitions/workspaceDocumentFileCreate';
import {
  readWritableWorkspaceParentSegments,
  resolveWorkspaceFileParentFolder,
} from '../functions/resolveWorkspaceFileParentFolder';

/**
 * 必须在调用方的同步事务内执行：每段重新读取当前树，复用并发创建的目录。
 * 不在这里管理文档事务，也不把 VFS 路径 materialize 成 Shell 物理目录。
 */
export function ensureWorkspaceFileParentFolders(params: {
  readonly projectId: string;
  readonly parentPath: string;
  readonly workspace: WorkspaceFileParentFolderPort;
}): WorkspaceFileParentFolders {
  const segments = readWritableWorkspaceParentSegments(params.parentPath);
  let parentId: string | null = null;
  const createdFolders: WorkspaceCreatedFileIdentity[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index];
    const path = `/${segments.slice(0, index + 1).join('/')}`;
    const existing = resolveWorkspaceFileParentFolder({
      children: params.workspace.getChildNodes(parentId, params.projectId),
      name,
      path,
      isVisibleNode: params.workspace.isVisibleNode,
    });
    if (existing) {
      parentId = existing.id;
      continue;
    }
    parentId = params.workspace.createFolder(params.projectId, name, parentId);
    createdFolders.push({ path, inode: `workspace:${parentId}` });
  }
  return { parentId, createdFolders };
}
