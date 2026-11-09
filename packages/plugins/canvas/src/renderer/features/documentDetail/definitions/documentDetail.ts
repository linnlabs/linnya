import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { DocumentPreviewMountInput } from '@plugin/renderer/documentPreview';
import type { EmbeddedMarkdownNavigationIntent } from '@plugin/renderer/embeddedMarkdownEditor';

export type CanvasDocumentDetailCard = Extract<CanvasCard, { type: 'document' }>;
export interface CanvasDocumentDetailPort {
  mount(input: DocumentPreviewMountInput): Promise<() => void>;
  prepare(id: CanvasCardId): Promise<'ready' | 'unavailable'>;
  visible(id: CanvasCardId, visible: boolean): void;
  navigate(intent: EmbeddedMarkdownNavigationIntent): void;
  focus(): void;
  open(card: CanvasDocumentDetailCard): Promise<void>;
}
