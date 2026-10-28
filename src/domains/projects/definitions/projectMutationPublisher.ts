import type { ProjectMutationEvent } from '@app/schemas';

/** App Host 注入呈现通知；Project 不依赖 Electron、Workspace registry 或 UI。 */
export interface ProjectMutationPublisher {
  publish(event: ProjectMutationEvent): void;
}
