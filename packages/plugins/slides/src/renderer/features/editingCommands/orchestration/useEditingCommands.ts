import { useSlidesRenderStore } from '../../../store/slidesRenderStore';
import { useSlidesStore } from '../../documentRuntime';
import { arrangeSelection } from '../functions/arrangeSelection';
import type { SelectionArrangement } from '../definitions/selectionArrangement';
import { computed, nextTick } from 'vue';
import { editableTextEqual } from '@plugin/slides/shared/authoringEditing';
import { collectPresentedManualTargets, useManualEditSubmission, useSlidesManualEditingStore, useManualEditingLocalization } from '../../manualEditing';
import { ownsDocumentShortcut, useSlidesEditingInteractionStore, useTextInputSession } from '../../editingInteraction';
import type { EditingCommandMessageKey } from '../definitions/editingCommandMessages';

/** 文档动作先交接输入，随后进入唯一串行队列；不创建第二套保存或撤销模型。 */
export function useEditingCommands() {
  const render = useSlidesRenderStore();
  const slides = useSlidesStore();
  const manual = useSlidesManualEditingStore();
  const editing = useSlidesEditingInteractionStore();
  const submission = useManualEditSubmission();
  const text = useTextInputSession(submission);
  const { manualEditingMessage } = useManualEditingLocalization();
  const hasDraft = computed(() => editing.textSession.phase === 'editing'
    && !editableTextEqual(editing.textSession.draft, editing.textSession.baseline));
  const pending = computed(() => manual.submission.phase === 'submitting' || manual.queue.length > 0);
  const hasFailure = computed(() => editing.textDrafts.some(draft => draft.status === 'failed')
    || (manual.errorMessage !== null && manual.submission.phase !== 'awaiting_frame'));
  const canUndo = computed(() => !hasFailure.value && ((manual.history?.undoDepth ?? 0) > 0 || hasDraft.value || pending.value));
  const canRedo = computed(() => !hasFailure.value && !hasDraft.value && !pending.value && (manual.history?.redoDepth ?? 0) > 0);
  const saveStatus = computed<EditingCommandMessageKey>(() => {
    if (hasFailure.value) return 'slides.editingCommands.failed';
    if (hasDraft.value || manual.translationPreview !== null) return 'slides.editingCommands.editing';
    if (pending.value) return 'slides.editingCommands.saving';
    if (manual.pendingPresentationRevision !== null) return 'slides.editingCommands.refreshing';
    if (manual.historyError) return 'slides.editingCommands.historyUnavailable';
    return 'slides.editingCommands.saved';
  });
  async function runHistory(action: 'undo' | 'redo'): Promise<void> {
    if (text.requestCommit() === 'blocked') {
      manual.setNotice(manualEditingMessage('slides.manualEditing.error.compositionUnfinished'));
      return;
    }
    try {
      await submission.flush();
      if ((action === 'undo' ? manual.history?.undoDepth : manual.history?.redoDepth) === 0 || !manual.history) return;
      manual.clearSelection();
      const settlement = await submission.enqueue({ operation: { op: action } }).settled;
      if (settlement.status !== 'presented' || !settlement.focus) return;
      // 让用户看见被撤销的修改：先跳到恢复后的页，换页清空选区之后再请求重新选中。
      const index = Math.min(settlement.focus.slideIndex, slides.slideCount - 1);
      if (index >= 0 && index !== slides.currentSlideIndex) {
        slides.setCurrentSlide(index);
        await nextTick();
      }
      if (settlement.focus.targets.length > 0) manual.requestReveal({ targets: settlement.focus.targets });
    } catch (error) {
      // 写入失败已由队列记录；这里只补充未写入的原因，不能伪造一次保存失败。
      if (!manual.errorMessage) manual.setNotice(error instanceof Error ? error.message : manualEditingMessage('slides.manualEditing.error.saveFailed'));
    }
  }
  function setLayer(direction: 'front' | 'back' | 'forward' | 'backward'): void {
    const target = manual.selectedTargets.length === 1 ? manual.selectedTarget : null;
    if (!target || text.requestCommit() === 'blocked') return;
    submission.enqueue({ operation: { op: 'set_layer', target: target.authoringRef, direction } });
  }
  function arrange(action: SelectionArrangement): void {
    const slide = render.currentSlideRender;
    const size = render.renderModel?.slideSize;
    if (!slide || !size || text.requestCommit() === 'blocked') return;
    const targets = collectPresentedManualTargets(slide.elements, {
      transientTranslation: manual.translationPreview, pendingTranslations: manual.pendingTranslations,
      pendingVisuals: manual.pendingVisuals, queuedIntents: manual.queuedIntents,
    }).filter(target => manual.selectedTargets.some(selected => selected.elementId === target.elementId));
    const intent = arrangeSelection(targets, action, size);
    if (intent) submission.enqueue(intent);
  }
  function handleHistoryShortcut(event: KeyboardEvent): void {
    if (!manual.enabled || !ownsDocumentShortcut(event) || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const action = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && !event.shiftKey ? 'redo' : null;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && (action === 'undo' ? canUndo.value : canRedo.value)) void runHistory(action);
  }
  return { setLayer, canUndo, canRedo, saveStatus, runHistory, handleHistoryShortcut, arrange };
}
