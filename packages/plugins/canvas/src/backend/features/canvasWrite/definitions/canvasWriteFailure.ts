import type { DocumentReferenceMarkdownError } from '@plugin/backend/documentReferences';

export class CanvasWriteFailure extends Error {
  constructor(
    readonly code:
      | 'wrong_element_type'
      | 'element_missing'
      | 'invalid_content'
      | 'image_unavailable'
      | 'document_unavailable'
      | DocumentReferenceMarkdownError['code'],
    message: string,
    readonly operation?: number,
    readonly field?: string
  ) {
    super(message);
    this.name = 'CanvasWriteFailure';
  }
}
