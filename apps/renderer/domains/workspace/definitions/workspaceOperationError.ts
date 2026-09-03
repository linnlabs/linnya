import type { WorkspaceOperationFailure } from './workspaceOperationFailure';

export class WorkspaceOperationError extends Error {
  constructor(readonly failure: WorkspaceOperationFailure) {
    super(failure.error);
    this.name = 'WorkspaceOperationError';
  }
}

export function getWorkspaceOperationFailure(error: unknown): WorkspaceOperationFailure | null {
  return error instanceof WorkspaceOperationError ? error.failure : null;
}
