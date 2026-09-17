import { refreshMarkdownDocumentSession } from '@/domains/editor/features/document-session';
import { useUIStore } from '@/shared/stores/ui';

/** App 只转发 mutation；文档身份、异步顺序与快照安装由 Editor owner 负责。 */
export async function applyPendingRevisionsToOpenMarkdownDocument(documentId: string): Promise<void> {
  const editor = useUIStore().getEditor();
  if (editor) await refreshMarkdownDocumentSession(editor, documentId);
}
