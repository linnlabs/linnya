import type { DocumentPreviewResult } from '@app/schemas';

export interface CanvasDocumentSurfacePresentation {
  readonly title: string | null;
  readonly status?: DocumentPreviewResult['status'];
  readonly summary?: string;
  readonly image?: string;
}
