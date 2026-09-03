export interface WorkspaceDocumentLifecycleNode {
  readonly id: string;
  readonly project_id: string | null;
  readonly parent_id: string | null;
  readonly type: string;
  readonly name: string;
}

export interface WorkspaceDocumentLifecycleNodePort {
  readonly getNode: (nodeId: string) => WorkspaceDocumentLifecycleNode | null;
  readonly createAvailableSiblingName: (params: {
    readonly projectId: string;
    readonly parentId: string | null;
    readonly desiredName: string;
  }) => string;
  readonly createAvailableSiblingCopyName: (params: {
    readonly projectId: string;
    readonly parentId: string | null;
    readonly sourceName: string;
  }) => string;
}

export interface WorkspaceDocumentCreateRequest {
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: string;
}

export interface WorkspaceDocumentDuplicateRequest extends WorkspaceDocumentCreateRequest {
  readonly sourceDocumentId: string;
}

export interface WorkspaceDocumentLifecycleProvider {
  readonly displayName: string;
  readonly defaultDocumentName: string;
  readonly enabled: boolean;
  readonly disabledMessage: string;
  readonly create?: (
    request: WorkspaceDocumentCreateRequest,
  ) => Promise<{ readonly documentId: string }>;
  readonly duplicate?: (
    request: WorkspaceDocumentDuplicateRequest,
  ) => Promise<{ readonly documentId: string } | null>;
}

export type WorkspaceDocumentLifecycleProviderResolver = (
  documentType: string,
) => WorkspaceDocumentLifecycleProvider | undefined;
