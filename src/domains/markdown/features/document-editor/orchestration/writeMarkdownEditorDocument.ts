import type { MarkdownDocumentService } from '../../document-storage';
import type { MarkdownEditorDocumentWriteResult } from '../definitions/markdownEditorDocument';

export function writeMarkdownEditorDocument(params: {
  readonly documentId: string;
  readonly content: unknown;
  readonly documentStore: MarkdownDocumentService;
  readonly onChange?: (before: number | undefined, after: number) => void;
}): MarkdownEditorDocumentWriteResult {
  return params.documentStore.runInTransaction(() => {
    const previous = params.documentStore.getLatestVersion(params.documentId);
    const saved = params.documentStore.updateDocument(params.documentId, params.content);
    // 根据规范化后的实际正文判断，同一内容重复保存不制造改动记录。
    if (saved.content_json !== previous?.content_json) params.onChange?.(previous?.version_number, saved.version_number);
    return { versionNumber: saved.version_number };
  });
}
