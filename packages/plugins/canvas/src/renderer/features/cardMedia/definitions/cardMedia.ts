import type { DocumentImageAsset, DocumentPreviewRequest, DocumentPreviewResult, DocumentReferencePresentation, WorkspaceMutationEvent } from '@app/schemas';
import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
export interface CanvasCardMediaPort {
  readImage(documentId: string, assetId: string): Promise<DocumentImageAsset>;
  preview(input: DocumentPreviewRequest): Promise<DocumentPreviewResult>;
  reference(documentId: string): Promise<DocumentReferencePresentation>;
  subscribe(listener: (event: WorkspaceMutationEvent) => void): () => void;
  subscribeAvailability(listener: (documentNodeTypes: readonly string[]) => void): () => void;
  projectId(): string | null;
  openDocument(documentId: string, nodeType: string, title: string | null): Promise<void>;
}
/** 单目标身份世代与整组变代计数；预览结果返回本身不改变身份世代。 */
export interface CanvasDocumentReferenceVersions {
  version(documentId: string): number;
  generation(): number;
}
export type CanvasReferenceMetadataChange =
  | { readonly kind: 'resolved' | 'invalidated' }
  | { readonly kind: 'failed'; readonly error: Error };
export interface CanvasCardContent {
  create(card: CanvasCard, signal: AbortSignal): Promise<HTMLElement>;
  stageImage(asset: DocumentImageAsset): Promise<void>;
  releaseStagedImages(assetIds: readonly string[]): void;
  resolveImageSource(source: string): Promise<string>;
  open(card: CanvasCard, opening?: (id: CanvasCardId) => void): Promise<void>;
  documentTitles(): ReadonlyMap<string, string>;
  contentKey(card: CanvasCard): string;
  refreshReferences(cards: readonly CanvasCard[]): Promise<void>;
  refreshVisible(cards: readonly CanvasCard[]): void;
  thumbnailCards(cards: readonly CanvasCard[]): ReadonlySet<CanvasCardId>;
  retry(): void;
  subscribe(listener: (failure: Error | null) => void): () => void;
  dispose(): void;
}
