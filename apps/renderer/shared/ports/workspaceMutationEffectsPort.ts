import type { WorkspaceMutationEvent } from '@app/schemas';

export interface WorkspaceMutationEffectsPort {
  handleWorkspaceMutation(event: WorkspaceMutationEvent): Promise<void>;
}

let registeredPort: WorkspaceMutationEffectsPort | null = null;

export function registerWorkspaceMutationEffectsPort(port: WorkspaceMutationEffectsPort): void {
  registeredPort = port;
}

export function getWorkspaceMutationEffectsPort(): WorkspaceMutationEffectsPort {
  if (!registeredPort) {
    throw new Error('[workspaceMutationEffectsPort] port has not been registered');
  }
  return registeredPort;
}
