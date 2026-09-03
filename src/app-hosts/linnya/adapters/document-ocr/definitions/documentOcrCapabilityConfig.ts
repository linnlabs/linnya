import type { DocumentOcrRoute } from '@app/schemas/document-ocr';

export interface DocumentOcrCapabilityConfig {
  readonly route: DocumentOcrRoute;
  readonly apiKey: string;
}
