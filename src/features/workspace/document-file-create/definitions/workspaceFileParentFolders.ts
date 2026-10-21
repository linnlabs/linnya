import type { WorkspaceNode } from '../../definitions/workspaceNode';
import type { WorkspaceCreatedFileIdentity } from './workspaceDocumentFileCreate';

/** 目录属于 Workspace 树，文档 provider 只在自己的提交边界内调用这个窄 port。 */
export interface WorkspaceFileParentFolderPort {
  readonly getChildNodes: (parentId: string | null, projectId: string) => readonly WorkspaceNode[];
  readonly isVisibleNode: (nodeId: string) => boolean;
  readonly createFolder: (projectId: string, name: string, parentId: string | null) => string;
}

export interface WorkspaceFileParentFolders {
  readonly parentId: string | null;
  readonly createdFolders: readonly WorkspaceCreatedFileIdentity[];
}
