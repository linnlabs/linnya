export interface WorkspaceNodeDeletionTarget {
  readonly id: string;
  readonly parentId: string | null;
}

export interface WorkspaceNodeDeletionFailure {
  readonly nodeId: string;
  readonly message: string;
}

export interface WorkspaceNodeDeletionResult {
  readonly deletedNodeIds: readonly string[];
  readonly failures: readonly WorkspaceNodeDeletionFailure[];
}

export interface WorkspaceNodeDeletionPort {
  deleteNodes(targets: readonly WorkspaceNodeDeletionTarget[]): Promise<WorkspaceNodeDeletionResult>;
  ensureProjectPageSelection(projectId: string): Promise<void>;
}

let registeredPort: WorkspaceNodeDeletionPort | null = null;

export function registerWorkspaceNodeDeletionPort(port: WorkspaceNodeDeletionPort): void {
  registeredPort = port;
}

export function getWorkspaceNodeDeletionPort(): WorkspaceNodeDeletionPort {
  if (!registeredPort) {
    throw new Error('[workspaceNodeDeletionPort] port has not been registered');
  }
  return registeredPort;
}
