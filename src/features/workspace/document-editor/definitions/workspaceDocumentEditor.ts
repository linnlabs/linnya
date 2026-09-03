export interface WorkspaceEditorDocumentIdentity {
  readonly documentId: string;
  readonly documentName: string;
  readonly documentType: string;
  readonly projectId: string | null;
}

export interface WorkspaceEditorDocumentNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly project_id: string | null;
}

export interface WorkspaceEditorDocumentNodeReader {
  readonly getNode: (documentId: string) => WorkspaceEditorDocumentNode | null;
}

export interface WorkspaceEditorDocumentReadResult {
  readonly content: unknown;
  readonly pendingRevisions: readonly unknown[];
}

export interface WorkspaceEditorDocumentWriteResult {
  readonly versionNumber?: number;
}

export interface WorkspaceDocumentEditorProvider {
  readonly displayName: string;
  readonly enabled: boolean;
  readonly disabledMessage: string;
  readonly read?: (
    identity: WorkspaceEditorDocumentIdentity,
  ) => Promise<WorkspaceEditorDocumentReadResult | null>;
  readonly write?: (
    identity: WorkspaceEditorDocumentIdentity,
    content: unknown,
  ) => Promise<WorkspaceEditorDocumentWriteResult>;
}

export type WorkspaceDocumentEditorProviderResolver = (
  documentType: string,
) => WorkspaceDocumentEditorProvider | undefined;
