import type {
  WorkspaceNodeTransferRequest,
  WorkspaceNodeTransferResult,
} from '@app/schemas';

export interface WorkspaceNodeTransferPort {
  transferNode(request: WorkspaceNodeTransferRequest): Promise<WorkspaceNodeTransferResult>;
}

export class WorkspaceNodeTransferSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceNodeTransferSaveError';
  }
}

let registeredPort: WorkspaceNodeTransferPort | null = null;

export function registerWorkspaceNodeTransferPort(port: WorkspaceNodeTransferPort): void {
  registeredPort = port;
}

export function getWorkspaceNodeTransferPort(): WorkspaceNodeTransferPort {
  if (!registeredPort) {
    throw new Error('[workspaceNodeTransferPort] port has not been registered');
  }
  return registeredPort;
}
