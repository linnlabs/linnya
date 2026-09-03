export type WorkspaceNavigationScope =
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'linnya-assistant' };

export type WorkspaceNavigationDocumentType = string;
export type WorkspaceDocumentNavigationParameter = string | number | boolean | null;
export type WorkspaceDocumentNavigationParameters = Readonly<Record<string, WorkspaceDocumentNavigationParameter>>;

export interface WorkspaceDocumentNavigationRequest {
  readonly documentId: string;
  readonly type: WorkspaceNavigationDocumentType;
  readonly projectId: string | null;
  readonly displayName?: string | null;
  readonly parentId?: string | null;
  readonly parameters?: WorkspaceDocumentNavigationParameters;
}

export interface WorkspaceConversationNavigationRequest {
  readonly conversationId: string;
  readonly scope: WorkspaceNavigationScope;
  readonly initialConversation?: {
    readonly title?: string | null;
    readonly createdAt?: number;
    readonly lastEventAt?: number;
    readonly projectId?: string | null;
    readonly mode?: string;
  };
}

export interface WorkspaceNavigationPort {
  openWorkspace(scope: WorkspaceNavigationScope): Promise<void>;
  openKnowledgeBase(): Promise<void>;
  openPluginStore(): Promise<void>;
  openProjectSetup(projectId: string): Promise<void>;
  openDocumentTarget(request: WorkspaceDocumentNavigationRequest): Promise<void>;
  openConversation(request: WorkspaceConversationNavigationRequest): Promise<void>;
  openDocument(request: WorkspaceDocumentNavigationRequest): Promise<void>;
  toggleWorkspacePanePlacement(): void;
  toggleWorkspaceRightPaneVisibility(): void;
  closeWorkspaceDocument(): Promise<void>;
}

export declare function getWorkspaceNavigationPort(): WorkspaceNavigationPort;
