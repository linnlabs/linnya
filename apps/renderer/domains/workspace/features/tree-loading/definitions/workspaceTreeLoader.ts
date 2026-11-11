import type { WorkspaceNode, WorkspaceVfsRuntimeContext, WorkspaceNodePatch, WorkspaceNodeStatePatch } from '../../../definitions/workspaceTree';

export interface WorkspaceTreeLoaderState {
  readonly projectTree: WorkspaceNode[];
  readonly loadedProjectId: string | null;
  readonly loadingProjectId: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly vfsRuntimeContext: WorkspaceVfsRuntimeContext;
  setProjectTree(nodes: WorkspaceNode[]): void;
  setLoadedProjectId(id: string | null): void;
  setLoadingProjectId(id: string | null): void;
  setLoading(value: boolean): void;
  setError(value: string | null): void;
  patchNode(node: WorkspaceNode, changes: WorkspaceNodePatch): void;
  applyNodePatches(patches: readonly WorkspaceNodeStatePatch[]): void;
}

export interface WorkspaceTreeLoader {
  loadProjectTree(projectId: string): Promise<void>;
  ensureProjectTreeLoaded(projectId: string): Promise<void>;
  reloadActiveProjectTree(): Promise<void>;
  loadNodeChildren(node: WorkspaceNode): Promise<void>;
  refreshAfterMove(oldParentId: string | null, newParentId: string | null): Promise<void>;
  toggleExpand(nodeId: string): Promise<void>;
  clearTree(): void;
}

