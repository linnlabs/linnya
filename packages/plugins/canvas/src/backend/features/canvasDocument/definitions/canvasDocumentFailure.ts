export type CanvasDocumentFailureCode =
  | 'document_missing'
  | 'selection_removed'
  | 'outside_project'
  | 'wrong_document_type'
  | 'projection_read_only'
  | 'runtime_closed'
  | 'view_closed'
  | 'tag_unavailable';
export class CanvasDocumentFailure extends Error {
  constructor(
    readonly code: CanvasDocumentFailureCode,
    message: string
  ) {
    super(message);
    this.name = 'CanvasDocumentFailure';
  }
}
