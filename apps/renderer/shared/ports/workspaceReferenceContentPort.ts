export interface WorkspaceReferenceContentPort {
  getMarkdownRootBlockIds(documentId: string): Promise<string[]>;
}

let registeredPort: WorkspaceReferenceContentPort | null = null;

export function registerWorkspaceReferenceContentPort(port: WorkspaceReferenceContentPort): void {
  registeredPort = port;
}

export function getWorkspaceReferenceContentPort(): WorkspaceReferenceContentPort {
  if (!registeredPort) {
    throw new Error('[workspaceReferenceContentPort] port has not been registered');
  }
  return registeredPort;
}
