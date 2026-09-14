import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type {
  ManualEditIntent,
  ManualEditableTarget,
  ManualEditingTranslationPreview,
  ManualEditingVisualPreview,
} from '../definitions/manualEditingTypes';
import { appendManualEditIntent } from '../functions/appendManualEditIntent';

export const useSlidesManualEditingStore = defineStore('slides-manual-editing', () => {
  const enabled = ref(false);
  const selectedTarget = shallowRef<ManualEditableTarget | null>(null);
  const selectionPath = shallowRef<readonly ManualEditableTarget[]>([]);
  const translationPreview = shallowRef<ManualEditingTranslationPreview | null>(null);
  const pendingTranslation = shallowRef<ManualEditingTranslationPreview | null>(null);
  const pendingVisual = shallowRef<ManualEditingVisualPreview | null>(null);
  const queuedIntents = shallowRef<readonly ManualEditIntent[]>([]);
  const textSubmissionPending = ref(false);
  const activeOperation = shallowRef<SlidesManualEditOperation | null>(null);
  const pendingPresentationRevision = ref<number | null>(null);
  const presentedRevision = ref<number | null>(null);
  const submitting = ref(false);
  const errorMessage = ref<string | null>(null);

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
    errorMessage.value = null;
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

  function beginSubmit(
    operation: SlidesManualEditOperation,
    optimisticTranslation?: ManualEditingTranslationPreview,
    optimisticVisual?: ManualEditingVisualPreview,
  ): void {
    submitting.value = true;
    activeOperation.value = operation;
    pendingPresentationRevision.value = null;
    pendingTranslation.value = optimisticTranslation ?? null;
    pendingVisual.value = optimisticVisual ?? null;
    textSubmissionPending.value = operation.op === 'set_text_content';
    translationPreview.value = null;
    errorMessage.value = null;
  }

  function enqueueIntent(intent: ManualEditIntent): void {
    queuedIntents.value = appendManualEditIntent(queuedIntents.value, intent);
    if (intent.operation.op === 'set_text_content') textSubmissionPending.value = true;
    errorMessage.value = null;
  }

  function startNextSubmit(): ManualEditIntent | null {
    if (
      submitting.value
      || pendingPresentationRevision.value !== null
      || queuedIntents.value.length === 0
    ) {
      return null;
    }
    const [intent, ...remaining] = queuedIntents.value;
    if (!intent) return null;
    queuedIntents.value = remaining;
    beginSubmit(intent.operation, intent.translationPreview, intent.visualPreview);
    if (
      intent.operation.op !== 'set_text_content'
      && queuedIntents.value.some(candidate => candidate.operation.op === 'set_text_content')
    ) {
      textSubmissionPending.value = true;
    }
    return intent;
  }

  function commitSubmit(revision: number): void {
    submitting.value = false;
    activeOperation.value = null;
    pendingPresentationRevision.value = revision;
    reconcilePresentedRevision();
  }

  function failSubmit(error: string): void {
    submitting.value = false;
    activeOperation.value = null;
    pendingTranslation.value = null;
    pendingVisual.value = null;
    pendingPresentationRevision.value = null;
    textSubmissionPending.value = false;
    queuedIntents.value = [];
    errorMessage.value = error;
  }

  /** 只有新 RenderModel 已呈现 committed revision，才能撤下乐观视觉。 */
  function recordPresentedRevision(revision: number): void {
    presentedRevision.value = revision;
    reconcilePresentedRevision();
  }

  function reconcilePresentedRevision(): void {
    if (
      pendingPresentationRevision.value === null
      || presentedRevision.value === null
      || presentedRevision.value < pendingPresentationRevision.value
    ) {
      return;
    }
    pendingTranslation.value = null;
    pendingVisual.value = null;
    pendingPresentationRevision.value = null;
    presentedRevision.value = null;
    textSubmissionPending.value = queuedIntents.value.some(
      intent => intent.operation.op === 'set_text_content',
    );
  }

  function clearSelection(): void {
    selectedTarget.value = null;
    selectionPath.value = [];
    translationPreview.value = null;
  }

  function $reset(): void {
    enabled.value = false;
    submitting.value = false;
    errorMessage.value = null;
    pendingTranslation.value = null;
    pendingVisual.value = null;
    activeOperation.value = null;
    pendingPresentationRevision.value = null;
    presentedRevision.value = null;
    textSubmissionPending.value = false;
    queuedIntents.value = [];
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
    textSubmissionPending,
    activeOperation,
    pendingPresentationRevision,
    presentedRevision,
    submitting,
    errorMessage,
    setEnabled,
    selectTarget,
    reconcileSelectedTarget,
    setTranslationPreview,
    beginSubmit,
    enqueueIntent,
    startNextSubmit,
    commitSubmit,
    failSubmit,
    recordPresentedRevision,
    clearSelection,
    $reset,
  };
});
