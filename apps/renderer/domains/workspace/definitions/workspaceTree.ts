export interface WorkspaceNode {
  id: string;
  inode?: string;
  path?: string;
  name: string;
  type: string;
  projectId: string;
  parentId: string | null;
  displayName?: string;
  children?: WorkspaceNode[] | null;
  isExpanded: boolean;
  depth: number;
  icon?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  isVirtual?: boolean;
  source?: string;
  payload?: Record<string, unknown>;
  isLoading?: boolean;
}

export interface WorkspaceVfsRuntimeContext {
  conversationId: string | null;
  instanceId: string | null;
}

/** 状态 action 只接纳编排已经计算好的节点字段。 */
export type WorkspaceNodePatch = Partial<Pick<WorkspaceNode,
  'type' | 'name' | 'displayName' | 'icon' | 'inode' | 'path' | 'isVirtual' | 'source' | 'payload' | 'updatedAt' | 'children' | 'isExpanded' | 'isLoading'
>>;

export interface WorkspaceNodeStatePatch {
  readonly node: WorkspaceNode;
  readonly changes: WorkspaceNodePatch;
}

export interface WorkspaceNodeReconciliation {
  readonly nodes: WorkspaceNode[];
  readonly patches: WorkspaceNodeStatePatch[];
}
