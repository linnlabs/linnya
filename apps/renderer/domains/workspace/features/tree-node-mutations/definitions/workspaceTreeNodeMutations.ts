import type { WorkspaceNode, WorkspaceNodePatch } from '../../../definitions/workspaceTree';

export interface CreateWorkspaceTreeDocumentInput {
  readonly name: string;
  readonly parentId: string | null;
  readonly type?: string;
  /** 手动创建默认进入重命名；自动创建可以显式关闭。 */
  readonly requestRename?: boolean;
  /** 是否展示当前会话的 New 标记。 */
  readonly markAsNew?: boolean;
}

export interface WorkspaceTreeNodeMutationDependencies {
  readonly setError: (value: string | null) => void;
  readonly patchNode: (node: WorkspaceNode, changes: WorkspaceNodePatch) => void;
  readonly findNodeById: (nodeId: string) => WorkspaceNode | null;
  readonly loadNodeChildren: (node: WorkspaceNode) => Promise<void>;
  readonly reloadActiveProjectTree: () => Promise<void>;
  readonly setRenameRequestNodeId: (nodeId: string | null) => void;
  readonly markNodeAsNew: (nodeId: string) => void;
}

export interface WorkspaceTreeNodeMutations {
  createFolder(args: { name: string; parentId: string | null }): Promise<string>;
  createDocument(args: CreateWorkspaceTreeDocumentInput): Promise<string>;
  renameNode(nodeId: string, newName: string): Promise<void>;
  duplicateNode(nodeId: string): Promise<string>;
  deleteNode(nodeId: string, parentId: string | null): Promise<string[]>;
}

