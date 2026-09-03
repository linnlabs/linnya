import type { WorkspaceDocumentMutationKind } from '@app/schemas';

export interface RendererDocumentMutationEvent {
  readonly mutationId: string;
  readonly projectId: string | null;
  readonly documentId: string;
  readonly nodeType: string;
  readonly activeDocumentType: string;
  readonly mutationKind: WorkspaceDocumentMutationKind;
  readonly versionNumber?: number;
}

export interface RendererDocumentMutationHandler {
  readonly id: string;
  readonly nodeType?: string;
  readonly activeDocumentType?: string;
  readonly handleMutation: (event: RendererDocumentMutationEvent) => void | Promise<void>;
}

export declare function registerRendererDocumentMutationHandler(handler: RendererDocumentMutationHandler): void;
export declare function unregisterRendererDocumentMutationHandler(id: string): void;
