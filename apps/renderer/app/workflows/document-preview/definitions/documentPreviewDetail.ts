import type { DocumentPreviewContent } from '@app/schemas';
export type DocumentPreviewDetailContent = NonNullable<DocumentPreviewContent['detail']>;
export interface DocumentPreviewMarkdownRuntime {
  parseMarkdownDocument: typeof import('@linnya/markdown-document-core').parseMarkdownDocument;
  createMarkdownDocumentFragment: typeof import('@linnya/markdown-document-core').createMarkdownDocumentFragment;
}
export type DocumentPreviewDetailPhase = 'idle' | 'loading' | 'ready' | 'failed';
