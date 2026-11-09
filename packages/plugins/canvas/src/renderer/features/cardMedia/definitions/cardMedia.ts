import type { Component } from 'vue';
import type {
  DocumentImageAsset,
  DocumentPreviewRequest,
  DocumentPreviewResult,
  DocumentReferencePresentation,
  WorkspaceMutationEvent,
} from '@app/schemas';
import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
/** 成功资源在短任务窗口合批，给120Hz场景留一帧内的通知预算；不在绘制RAF中编排。 */
export const CANVAS_CONTENT_NOTIFICATION_INTERVAL_MS = 8;
export const CANVAS_DOCUMENT_PREVIEW_CONCURRENCY = 4;
export const CANVAS_DOCUMENT_PREVIEW_CACHE_BYTES = 32 * 1024 * 1024;
export const CANVAS_DOCUMENT_PREVIEW_CACHE_ENTRIES = 128;
export interface CanvasDocumentPreviewCacheEntry {
  readonly result: DocumentPreviewResult;
  readonly bytes: number;
}
export interface CanvasDocumentPreviewPresentation {
  readonly version: number;
  readonly keep: boolean;
  readonly revision: string;
}
export interface CanvasDocumentPreviewCacheWrite {
  readonly identity: string;
  readonly documentId: string;
  readonly version: number;
  readonly result: DocumentPreviewResult;
}
export type CanvasPreviewReadPurpose = 'foreground' | 'prefetch';
export type CanvasDocumentCard = Extract<CanvasCard, { type: 'document' }>;
export interface CanvasPreviewInterestOptions {
  readonly versions: CanvasDocumentReferenceVersions;
  readonly projectId: () => string | null;
  readonly key: (card: CanvasDocumentCard) => string;
  readonly has: (identity: string) => boolean;
  readonly running: () => number;
  readonly read: (card: CanvasDocumentCard) => Promise<DocumentPreviewResult>;
  readonly failed: (failure: Error) => void;
}
export interface CanvasPreviewReadWaiter {
  readonly purpose: CanvasPreviewReadPurpose;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}
export interface CanvasCardMediaPort {
  readImage(documentId: string, assetId: string): Promise<DocumentImageAsset>;
  preview(input: DocumentPreviewRequest): Promise<DocumentPreviewResult>;
  reference(documentId: string): Promise<DocumentReferencePresentation>;
  subscribe(listener: (event: WorkspaceMutationEvent) => void): () => void;
  subscribeAvailability(listener: (documentNodeTypes: readonly string[]) => void): () => void;
  projectId(): string | null;
  openDocument(documentId: string, nodeType: string, title: string | null): Promise<void>;
  /** 文档类型在文件树里的图标；Host 未提供时为 null。 */
  typeIcon?(nodeType: string): Component | null;
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
  /** 文档卡标签用的类型图标；预览不可用时为 null。 */
  documentIcon(card: CanvasCard): Promise<Component | null>;
  contentKey(card: CanvasCard): string;
  refreshReferences(cards: readonly CanvasCard[]): Promise<void>;
  refreshVisible(cards: readonly CanvasCard[]): void;
  thumbnailCards(cards: readonly CanvasCard[]): ReadonlySet<CanvasCardId>;
  retry(): void;
  subscribe(listener: (failure: Error | null) => void): () => void;
  dispose(): void;
}
