import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { useFileStore } from '@/shared/stores/file';
import { useUIStore } from '@/shared/stores/ui';

/** 将工具直接提交的 Annotation 增删改同步到当前 Editor，不覆盖本地正文。 */
export async function synchronizeAnnotationsToOpenMarkdownDocument(
  documentId: string
): Promise<void> {
  if (!documentId.trim() || useFileStore().currentFilePath !== documentId) return;
  const editor = useUIStore().getEditor();
  const synchronize = editor?.annotationStore?.synchronizeAnnotationsFromDocumentJson;
  if (!editor || editor.isDestroyed || typeof synchronize !== 'function') return;

  const result = await workspaceGateway['read-document']({ documentId });
  if (!result.success || !result.data?.content) {
    console.warn('[markdownAnnotationRefresh] read-document 失败，无法同步批注。', {
      documentId,
      error: 'error' in result ? result.error : undefined,
    });
    return;
  }
  synchronize(result.data.content);
}
