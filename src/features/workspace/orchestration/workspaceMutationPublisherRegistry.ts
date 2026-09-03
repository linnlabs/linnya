import { parseWorkspaceMutationEvent } from '@app/schemas';
import type { WorkspaceMutationPublisher } from '../definitions/workspaceMutationPublisher';

let installedPublisher: WorkspaceMutationPublisher['publish'] | null = null;

/** App composition 显式安装当前进程的 Workspace mutation presentation 边界。 */
export function installWorkspaceMutationPublisher(
  publisher: WorkspaceMutationPublisher['publish'],
): void {
  if (installedPublisher && installedPublisher !== publisher) {
    throw new Error('Workspace mutation publisher 当前 App owner 已安装另一实现');
  }
  installedPublisher = publisher;
}

export function createWorkspaceMutationPublisher(): WorkspaceMutationPublisher {
  if (!installedPublisher) {
    throw new Error('Workspace mutation publisher 尚未由 App composition 安装');
  }
  const publisher = installedPublisher;
  const port: WorkspaceMutationPublisher = {
    publish(rawEvent) {
      publisher(parseWorkspaceMutationEvent(rawEvent));
    },
  };
  return Object.freeze(port);
}

export function clearWorkspaceMutationPublisherForTesting(): void {
  installedPublisher = null;
}
