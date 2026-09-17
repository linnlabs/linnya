import { onScopeDispose, watch } from 'vue';
import { getActiveFileSession, markActiveFileDirty } from '@plugin/renderer/workspaceRuntime';
import { registerSlidesDocumentSaveParticipant } from '../../features/documentRuntime';
import { useTextInputSession, useSlidesEditingInteractionStore } from '../../features/editingInteraction';
import { useSlidesManualEditingStore, useManualEditingLocalization, type ManualEditSubmissionPort } from '../../features/manualEditing';
import { useSlidesStore } from '../../store/slidesStore';

/** 页面组合根连接输入、写队列和文档生命周期；各 feature 不反向依赖对方。 */
export function useSlidesDocumentSave(submission: ManualEditSubmissionPort): void {
  const slides = useSlidesStore();
  const editing = useSlidesEditingInteractionStore();
  const manual = useSlidesManualEditingStore();
  const text = useTextInputSession(submission);
  const { manualEditingMessage: message } = useManualEditingLocalization();
  onScopeDispose(registerSlidesDocumentSaveParticipant({
    readDocumentId: () => slides.currentDeckId,
    async save(finishInput) {
      // 实时编辑已在结束输入时自动提交；后台定时器不能打断正在输入的会话。
      if (!finishInput && editing.textSession.phase === 'editing') return false;
      do {
        if (text.requestCommit() === 'blocked') {
          throw new Error(message('slides.manualEditing.error.compositionUnfinished'));
        }
        await submission.flush();
        // 等待期间仍允许交互；退出前把这段时间的新输入也交给同一队列。
      } while (editing.textSession.phase === 'editing' && editing.textSession.draft !== editing.textSession.baseline);
      if (editing.textDrafts.some(draft => draft.status === 'failed')) {
        throw new Error(message('slides.manualEditing.error.textDraftRetained'));
      }
      return true;
    },
  }));
  watch(() => {
    const session = editing.textSession;
    return manual.submission.phase === 'submitting' || manual.queue.length > 0
      || editing.textDrafts.some(draft => draft.status === 'failed')
      || (session.phase === 'editing' && session.draft !== session.baseline);
  }, dirty => {
    if (getActiveFileSession()?.documentId === slides.currentDeckId) markActiveFileDirty(dirty);
  });
}
