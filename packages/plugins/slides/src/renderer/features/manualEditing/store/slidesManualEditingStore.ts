import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type {
  ManualEditableTarget,
  ManualEditingTranslationPreview,
} from '../definitions/manualEditingTypes';
import type { ManualEditQueueEntry, ManualEditSubmissionState } from '../definitions/manualEditQueue';

export const useSlidesManualEditingStore = defineStore('slides-manual-editing', () => {
  const enabled = ref(false);
  const selectedTarget = shallowRef<ManualEditableTarget | null>(null);
  const selectionPath = shallowRef<readonly ManualEditableTarget[]>([]);
  const translationPreview = shallowRef<ManualEditingTranslationPreview | null>(null);
  const queue = shallowRef<readonly ManualEditQueueEntry[]>([]);
  const submission = shallowRef<ManualEditSubmissionState>({ phase: 'idle' });
  const presentedRevision = ref<number | null>(null);
  const errorMessage = ref<string | null>(null);
  const queuedIntents = computed(() => queue.value.map(entry => entry.intent));
  const activeIntent = computed(() => submission.value.phase === 'idle' ? null : submission.value.entry.intent);
  const pendingTranslation = computed(() => activeIntent.value?.translationPreview ?? null);
  const pendingVisual = computed(() => activeIntent.value?.visualPreview ?? null);
  const submitting = computed(() => submission.value.phase === 'submitting');
  const pendingPresentationRevision = computed(() => submission.value.phase === 'awaiting_frame'
    ? submission.value.revision : null);

  function setEnabled(value: boolean): void {
    enabled.value = value;
    if (!value) {
      clearSelection();
    }
  }

  function selectTarget(
    target: ManualEditableTarget | null,
    path: readonly ManualEditableTarget[] = target ? [target] : [],
  ): void {
    selectedTarget.value = target;
    selectionPath.value = target ? path : [];
    translationPreview.value = null;
  }

  function reconcileSelectedTarget(
    target: ManualEditableTarget | null,
    path: readonly ManualEditableTarget[] = target ? [target] : [],
  ): void {
    selectedTarget.value = target;
    selectionPath.value = target ? path : [];
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

  /** 只记录画面事实；回执结算与后续提交由 queue orchestration 负责。 */
  function recordPresentedRevision(revision: number): void {
    presentedRevision.value = revision;
  }

  function clearSelection(): void {
    selectedTarget.value = null;
    selectionPath.value = [];
    translationPreview.value = null;
  }

  function $reset(): void {
    enabled.value = false;
    submission.value = { phase: 'idle' };
    queue.value = [];
    presentedRevision.value = null;
    errorMessage.value = null;
    clearSelection();
  }

  return {
    enabled,
    selectedTarget,
    selectionPath,
    translationPreview,
    pendingTranslation,
    pendingVisual,
    queuedIntents,
    queue,
    submission,
    pendingPresentationRevision,
    presentedRevision,
    submitting,
    errorMessage,
    setEnabled,
    selectTarget,
    reconcileSelectedTarget,
    setTranslationPreview,
    setQueue,
    setSubmission,
    setError,
    recordPresentedRevision,
    clearSelection,
    $reset,
  };
});
