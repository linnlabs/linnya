import { shallowRef } from 'vue';
import type { DocumentActionMenuContribution } from '@/app/plugins/types';
import { resolveCurrentLayoutMessage } from '@/app/layout/functions/resolveCurrentLayoutMessage';
import { useNotificationStore } from '@/app/notification';

interface MarkdownSelection {
  readonly projectId: string;
  readonly documentId: string;
  readonly markdown: string;
  readonly displayName: string;
}

/** 此官方装配只保持一次操作的冻结快照，知识库上传业务由 owner 接纳。 */
export function createKnowledgeDocumentActions(onError: (error: unknown) => void) {
  const selection = shallowRef<MarkdownSelection | null>(null);
  let pending: AbortController | null = null;
  function cancel() { pending?.abort(); pending = null; selection.value = null; }
  const menu: DocumentActionMenuContribution = {
    activeDocumentType: 'editor',
    tooltip: 'Document actions',
    ariaLabel: 'Document actions',
    isAvailable: context => context.activeDocumentType === 'editor',
    getOptions: () => [{ value: 'add-to-kb', text: resolveCurrentLayoutMessage('layout.header.documentMenu.addToKnowledgeBase') }],
    async select(value, context) {
      if (value !== 'add-to-kb' || !context.readMarkdownSnapshot) return;
      cancel();
      const controller = new AbortController();
      pending = controller;
      try {
        const snapshot = await context.readMarkdownSnapshot(controller.signal);
        if (!controller.signal.aborted) selection.value = Object.freeze({
          projectId: context.projectId, documentId: context.documentId, ...snapshot,
        });
      } catch (error) {
        // 切项目或停用会撤销这次动作；取消不是上传失败，也不能挂出迟到弹窗。
        if (!controller.signal.aborted) onError(error);
      } finally {
        if (pending === controller) pending = null;
      }
    },
  };
  return { selection, menu, cancel };
}
export const knowledgeDocumentActions = createKnowledgeDocumentActions(error => {
  useNotificationStore().show(error instanceof Error ? error.message
    : resolveCurrentLayoutMessage('layout.header.addToKnowledgeBase.failed'), 'error', 4000);
});
