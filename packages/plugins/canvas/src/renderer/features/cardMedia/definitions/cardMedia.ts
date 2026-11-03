import type { DocumentImageAsset, DocumentPreviewRequest, DocumentPreviewResult, DocumentReferencePresentation, WorkspaceMutationEvent } from '@app/schemas';
import type { CanvasCard } from '@plugin/canvas/shared';
export interface CanvasCardMediaPort {
  readImage(documentId: string, assetId: string): Promise<DocumentImageAsset>;
  preview(input: DocumentPreviewRequest): Promise<DocumentPreviewResult>;
  reference(documentId: string): Promise<DocumentReferencePresentation>;
  subscribe(listener: (event: WorkspaceMutationEvent) => void): () => void;
  subscribeAvailability(listener: (documentNodeTypes: readonly string[]) => void): () => void;
  projectId(): string | null;
  openDocument(documentId: string, nodeType: string, title: string | null): Promise<void>;
}
export interface CanvasCardContent {
  create(card: CanvasCard, signal: AbortSignal): Promise<HTMLElement>;
  stageImage(asset: DocumentImageAsset): void;
  resolveImageSource(source: string): Promise<string>;
  open(card: CanvasCard): Promise<void>;
  documentTitles(): ReadonlyMap<string, string>;
  contentKey(card: CanvasCard): string;
  refreshReferences(cards: readonly CanvasCard[]): Promise<void>;
  subscribe(listener: (failure: Error | null) => void): () => void;
  dispose(): void;
}
