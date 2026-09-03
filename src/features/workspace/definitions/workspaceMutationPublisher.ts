import type { WorkspaceMutationEvent } from '@app/schemas';

export interface WorkspaceMutationPublisher {
  publish(event: WorkspaceMutationEvent): void;
}
