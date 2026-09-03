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
