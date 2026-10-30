import type { SlidesManualEditHistoryStatus } from '@plugin/slides/shared/authoringEditing';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type {
  ManualEditableTarget,
  ManualEditingTranslationPreview,
  ManualEditRevealRequest,
} from '../definitions/manualEditingTypes';
import type { ManualEditQueueEntry, ManualEditSubmissionState } from '../definitions/manualEditQueue';
import { ownsManualPageOrder } from '../functions/manualEditPageOrder';

export const useSlidesManualEditingStore = defineStore('slides-manual-editing', () => {
  const history = shallowRef<SlidesManualEditHistoryStatus | null>(null);
  const historyError = ref(false);
  const enabled = ref(false);
  const selectedTargets = shallowRef<readonly ManualEditableTarget[]>([]);
  const selectedTarget = computed(() => selectedTargets.value[selectedTargets.value.length - 1] ?? null);
  const selectionPath = shallowRef<readonly ManualEditableTarget[]>([]);
  const translationPreview = shallowRef<ManualEditingTranslationPreview | null>(null);
  /** 撤销、插入或粘贴呈现后要在当前页选中的作者对象；由画布交互解析成目标后清空。 */
  const revealRequest = shallowRef<ManualEditRevealRequest | null>(null);
  const queue = shallowRef<readonly ManualEditQueueEntry[]>([]);
  const submission = shallowRef<ManualEditSubmissionState>({ phase: 'idle' });
  const presentedRevision = ref<number | null>(null);
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

  /** 文稿当前能否手动写入；选区独立于它，只读时仍可选中对象交给 AI。 */
  function setEnabled(value: boolean): void {
    enabled.value = value;
  }

  function selectTarget(
    target: ManualEditableTarget | null,
    path: readonly ManualEditableTarget[] = target ? [target] : [],
  ): void {
    selectedTargets.value = target ? [target] : [];
    selectionPath.value = target ? path : [];
    translationPreview.value = null;
  }

  function reconcileSelectedTarget(
    target: ManualEditableTarget | null,
    path: readonly ManualEditableTarget[] = target ? [target] : [],
  ): void {
    selectedTargets.value = target ? [target] : [];
    selectionPath.value = target ? path : [];
  }

  function selectTargets(targets: readonly ManualEditableTarget[], path: readonly ManualEditableTarget[] = []): void {
    selectedTargets.value = targets;
    selectionPath.value = path;
  }

  function requestReveal(request: ManualEditRevealRequest | null): void {
    revealRequest.value = request;
  }

  function setTranslationPreview(preview: ManualEditingTranslationPreview | null): void {
    translationPreview.value = preview;
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

  /** 只记录画面事实；回执结算与后续提交由 queue orchestration 负责。 */
  function recordPresentedRevision(revision: number): void {
    presentedRevision.value = revision;
  }

  function clearSelection(): void {
    selectedTargets.value = [];
    selectionPath.value = [];
    translationPreview.value = null;
  }

  function $reset(): void {
    setHistory(null);
    enabled.value = false;
    submission.value = { phase: 'idle' };
    queue.value = [];
    presentedRevision.value = null;
    errorMessage.value = null;
    notice.value = null;
    revealRequest.value = null;
    clearSelection();
  }

  return {
    history, historyError, setHistory, setHistoryError,
    enabled,
    selectedTarget, selectedTargets, selectTargets,
    selectionPath,
    translationPreview,
    revealRequest,
    requestReveal,
    pendingTranslations,
    pendingInsertions,
    pendingVisuals,
    queuedIntents,
    pendingPageOperation,
    queue,
    submission,
    pendingPresentationRevision,
    presentedRevision,
    submitting,
    errorMessage,
    notice,
    setEnabled,
    selectTarget,
    reconcileSelectedTarget,
    setTranslationPreview,
    setQueue,
    setSubmission,
    setError,
    setNotice,
    recordPresentedRevision,
    clearSelection,
    $reset,
  };
});
