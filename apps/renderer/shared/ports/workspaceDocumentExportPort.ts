export interface SaveWorkspaceHtmlDocumentParams {
  name: string;
  html: string;
}

export interface SaveWorkspaceHtmlDocumentResult {
  success: boolean;
  documentId?: string;
  error?: string;
}

export interface WorkspaceDocumentExportPort {
  saveHtmlAsMarkdownDocument(
    params: SaveWorkspaceHtmlDocumentParams
  ): Promise<SaveWorkspaceHtmlDocumentResult>;
}

let registeredPort: WorkspaceDocumentExportPort | null = null;

export function registerWorkspaceDocumentExportPort(port: WorkspaceDocumentExportPort): void {
  registeredPort = port;
}

export function getWorkspaceDocumentExportPort(): WorkspaceDocumentExportPort {
  if (!registeredPort) {
    throw new Error('[workspaceDocumentExportPort] port has not been registered');
  }
  return registeredPort;
}
