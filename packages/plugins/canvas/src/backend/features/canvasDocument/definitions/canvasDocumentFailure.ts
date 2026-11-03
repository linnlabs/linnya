export type CanvasDocumentFailureCode = 'document_missing' | 'outside_project' | 'wrong_document_type' | 'projection_read_only';
export class CanvasDocumentFailure extends Error {
  constructor(readonly code: CanvasDocumentFailureCode, message: string) {
    super(message);
    this.name = 'CanvasDocumentFailure';
  }
}
