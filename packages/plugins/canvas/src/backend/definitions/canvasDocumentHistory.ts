import type { DocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import type { CanvasDatabase } from './canvasDatabase';
export interface CanvasDocumentHistoryOptions {
  readonly database: CanvasDatabase;
  readonly references: DocumentReferenceMarkdownRuntime;
  readonly assertActive: () => void;
  readonly hasView: (documentId: string, viewId: string) => boolean;
  readonly scheduleTextSnapshot: (documentId: string) => void;
}
