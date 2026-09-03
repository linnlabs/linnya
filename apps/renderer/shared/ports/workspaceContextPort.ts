// 中文说明：文档类型来自 renderer document type registry；Host 不维护插件类型枚举。
export type WorkspaceContextDocumentType = string;

export interface WorkspaceActiveDocumentSession {
  documentId: string;
  displayName?: string | null;
  type: WorkspaceContextDocumentType;
}

export interface WorkspaceDocumentSummary {
  id: string;
  title?: string;
  type: WorkspaceContextDocumentType;
  projectId?: string;
}

export interface WorkspaceProjectSummary {
  id: string;
  name?: string;
  description?: string;
}

export interface WorkspaceProjectFileSummary {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

export interface WorkspaceContextPort {
  getActiveDocumentSession(): WorkspaceActiveDocumentSession | null;
  findDocumentSummary(documentId: string): WorkspaceDocumentSummary | null;
  getCurrentProjectSummary(projectId?: string | null): WorkspaceProjectSummary | null;
  getProjectFileSummaries(projectId: string, options?: { limit?: number }): WorkspaceProjectFileSummary[];
  requestSaveBeforeAiInvoke(): Promise<boolean>;
}

let registeredPort: WorkspaceContextPort | null = null;

export function registerWorkspaceContextPort(port: WorkspaceContextPort): void {
  registeredPort = port;
}

export function getWorkspaceContextPort(): WorkspaceContextPort {
  if (!registeredPort) {
    throw new Error('[workspaceContextPort] port has not been registered');
  }
  return registeredPort;
}
