import type { SlidesManualEditHistoryStatus } from '@plugin/slides/shared/authoringEditing';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { ManualEditQueueEntry, ManualEditSubmissionState } from '../definitions/manualEditQueue';
import { ownsManualPageOrder } from '../functions/manualEditPageOrder';

export const useSlidesManualSubmissionStore = defineStore('slides-manual-submission', () => {
  const history = shallowRef<SlidesManualEditHistoryStatus | null>(null);
  const historyError = ref(false);
  const queue = shallowRef<readonly ManualEditQueueEntry[]>([]);
  const submission = shallowRef<ManualEditSubmissionState>({ phase: 'idle' });
  /** 写入失败：参与保存屏障与撤销门控，只由提交队列设置。 */
  const errorMessage = ref<string | null>(null);
  /** 未发生写入的操作提示，例如不可复制或图片过大；不能阻塞保存、切换和撤销。 */
  const notice = ref<string | null>(null);
  const queuedIntents = computed(() => queue.value.map(entry => entry.intent));
  const activeIntent = computed(() => submission.value.phase === 'idle' ? null : submission.value.entry.intent);
  // 依赖页序的动作在正式快照呈现前互斥，避免把旧页索引用于新文稿。
  const pendingPageOperation = computed(() => queue.value.some(entry => ownsManualPageOrder(entry.intent.operation))
    || (activeIntent.value !== null && ownsManualPageOrder(activeIntent.value.operation)));
  const pendingTranslations = computed(() => activeIntent.value?.translationPreviews ?? []);
  /** 新增预览跟随队列生命周期；提交失败或正式帧呈现时一起撤下。 */
  const pendingInsertions = computed(() => [...activeIntent.value ? [activeIntent.value] : [], ...queuedIntents.value]
    .flatMap(({ operation, insertionImageSources }) => {
      if (operation.op !== 'insert_objects') return [];
      const slideIndex = operation.index;
      return operation.objects.map(object => ({ slideIndex, object,
        ...(insertionImageSources?.has(object.editKey) ? { imageSource: insertionImageSources.get(object.editKey) } : {}),
      }));
    }));
  const pendingVisuals = computed(() => activeIntent.value?.visualPreviews ?? []);
  const submitting = computed(() => submission.value.phase === 'submitting');
  const pendingPresentationRevision = computed(() => submission.value.phase === 'awaiting_frame'
    ? submission.value.revision : null);

  function setHistory(value: SlidesManualEditHistoryStatus | null): void {
    history.value = value;
    historyError.value = false;
  }

  function setHistoryError(value: boolean): void {
    historyError.value = value;
  }

  function setQueue(entries: readonly ManualEditQueueEntry[]): void {
    queue.value = entries;
  }

  function setSubmission(value: ManualEditSubmissionState): void {
    submission.value = value;
  }

  function setError(message: string | null): void {
    errorMessage.value = message;
  }

  function setNotice(message: string | null): void {
    notice.value = message;
  }

  function $reset(): void {
    setHistory(null);
    submission.value = { phase: 'idle' };
    queue.value = [];
    errorMessage.value = null;
    notice.value = null;
  }

  return {
    history, historyError, setHistory, setHistoryError,
    pendingTranslations,
    pendingInsertions,
    pendingVisuals,
    queuedIntents,
    pendingPageOperation,
    queue,
    submission,
    pendingPresentationRevision,
    submitting,
    errorMessage,
    notice,
    setQueue,
    setSubmission,
    setError,
    setNotice,
    $reset,
  };
});
