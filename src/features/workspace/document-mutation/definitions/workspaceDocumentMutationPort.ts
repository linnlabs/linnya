export interface WorkspaceDocumentMutationPort {
  readonly touchDocumentUpdatedAt: (documentId: string, updatedAt: number) => void;
}
