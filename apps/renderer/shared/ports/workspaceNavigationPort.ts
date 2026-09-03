export type WorkspaceNavigationScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'linnya-assistant' };

// 中文说明：打开文档的 activeDocumentType 来自 renderer documentType registry。
export type WorkspaceNavigationDocumentType = string;
export type WorkspaceDocumentNavigationParameter = string | number | boolean | null;
export type WorkspaceDocumentNavigationParameters = Readonly<Record<string, WorkspaceDocumentNavigationParameter>>;

export interface WorkspaceDocumentNavigationRequest {
  documentId: string;
  type: WorkspaceNavigationDocumentType;
  projectId: string | null;
  displayName?: string | null;
  parentId?: string | null;
  parameters?: WorkspaceDocumentNavigationParameters;
}

export interface WorkspaceConversationNavigationRequest {
  conversationId: string;
  scope: WorkspaceNavigationScope;
  initialConversation?: {
    title?: string | null;
    createdAt?: number;
    lastEventAt?: number;
    userMessageCount?: number;
    projectId?: string | null;
    mode?: string;
  };
}

export interface WorkspaceNavigationPort {
  openWorkspace(scope: WorkspaceNavigationScope): Promise<void>;
  openEmptyProjectFiles(projectId: string): Promise<void>;
  openKnowledgeBase(): Promise<void>;
  openPluginStore(): Promise<void>;
  openProjectSetup(projectId: string): Promise<void>;
  /**
   * 工具卡/实体引用打开文档内目标时使用。
   * 当前面向由 documentRuntimeLoaders 接管的 runtime 文档，避免通用 port 暴露具体插件方法名。
   */
  openDocumentTarget(request: WorkspaceDocumentNavigationRequest): Promise<void>;
  openConversation(request: WorkspaceConversationNavigationRequest): Promise<void>;
  openDocument(request: WorkspaceDocumentNavigationRequest): Promise<void>;
  toggleWorkspacePanePlacement(): void;
  toggleWorkspaceRightPaneVisibility(): void;
  closeWorkspaceDocument(): Promise<void>;
}

let registeredPort: WorkspaceNavigationPort | null = null;

export function registerWorkspaceNavigationPort(port: WorkspaceNavigationPort): void {
  registeredPort = port;
}

export function getWorkspaceNavigationPort(): WorkspaceNavigationPort {
  if (!registeredPort) {
    throw new Error('[workspaceNavigationPort] port has not been registered');
  }
  return registeredPort;
}
