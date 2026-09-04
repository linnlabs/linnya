import type { MarkdownDocumentService } from '../../document-storage';
import type { MarkdownNormalizationService } from '../../normalization';
import type { MarkdownEditorDocumentReadResult } from '../definitions/markdownEditorDocument';
import { projectMarkdownEditorPendingRevisions } from '../functions/projectMarkdownEditorPendingRevisions';

export async function readMarkdownEditorDocument(params: {
  readonly documentId: string;
  readonly documentStore: MarkdownDocumentService;
  readonly normalizer: MarkdownNormalizationService;
}): Promise<MarkdownEditorDocumentReadResult> {
  await params.normalizer.normalizeDocumentIfNeeded(params.documentId);
  const version = params.documentStore.getLatestVersion(params.documentId);
  if (!version) {
    throw new Error(`Document not found: ${params.documentId}`);
  }
  return {
    content: params.documentStore.getDocument(params.documentId),
    pendingRevisions: projectMarkdownEditorPendingRevisions(
      params.documentStore.getPendingRevisions(params.documentId),
    ),
    versionNumber: version.version_number,
  };
}
