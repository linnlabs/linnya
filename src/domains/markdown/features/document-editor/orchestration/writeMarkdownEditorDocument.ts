import type { MarkdownDocumentService } from '../../document-storage';
import type { MarkdownEditorDocumentWriteResult } from '../definitions/markdownEditorDocument';

export function writeMarkdownEditorDocument(params: {
  readonly documentId: string;
  readonly content: unknown;
  readonly documentStore: MarkdownDocumentService;
}): MarkdownEditorDocumentWriteResult {
  const version = params.documentStore.updateDocument(params.documentId, params.content);
  return { versionNumber: version.version_number };
}
