import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type {
  ManualEditableTarget,
  ManualEditingTranslationPreview,
} from '../definitions/manualEditingTypes';

export const useSlidesManualEditingStore = defineStore('slides-manual-editing', () => {
  const enabled = ref(false);
  const selectedTarget = shallowRef<ManualEditableTarget | null>(null);
  const translationPreview = shallowRef<ManualEditingTranslationPreview | null>(null);
  const pendingTranslation = shallowRef<ManualEditingTranslationPreview | null>(null);
  const textEditorTarget = shallowRef<ManualEditableTarget | null>(null);
  const textDraft = ref('');
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
      closeTextEditor();
    }
  }

  function selectTarget(target: ManualEditableTarget | null): void {
    selectedTarget.value = target;
    translationPreview.value = null;
    errorMessage.value = null;
  }

  function reconcileSelectedTarget(target: ManualEditableTarget | null): void {
    selectedTarget.value = target;
    if (textEditorTarget.value?.elementId !== selectedTarget.value?.elementId) {
      closeTextEditor();
      return;
    }
    if (target) textEditorTarget.value = target;
  }

  function setTranslationPreview(preview: ManualEditingTranslationPreview | null): void {
    translationPreview.value = preview;
  }

  function openTextEditor(target: ManualEditableTarget): void {
    textEditorTarget.value = target;
    textDraft.value = target.textContent ?? '';
  }

  function updateTextDraft(value: string): void {
    textDraft.value = value;
  }

  function closeTextEditor(): void {
    textEditorTarget.value = null;
    textDraft.value = '';
  }

  function beginSubmit(
    operation: SlidesManualEditOperation,
    optimisticTranslation?: ManualEditingTranslationPreview,
  ): void {
    submitting.value = true;
    activeOperation.value = operation;
    pendingPresentationRevision.value = null;
    pendingTranslation.value = optimisticTranslation ?? null;
    textSubmissionPending.value = operation.op === 'set_text_content';
    translationPreview.value = null;
    errorMessage.value = null;
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
    pendingPresentationRevision.value = null;
    textSubmissionPending.value = false;
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
    pendingPresentationRevision.value = null;
    presentedRevision.value = null;
    if (textSubmissionPending.value) closeTextEditor();
    textSubmissionPending.value = false;
  }

  function clearSelection(): void {
    selectedTarget.value = null;
    translationPreview.value = null;
  }

  function $reset(): void {
    enabled.value = false;
    submitting.value = false;
    errorMessage.value = null;
    pendingTranslation.value = null;
    activeOperation.value = null;
    pendingPresentationRevision.value = null;
    presentedRevision.value = null;
    textSubmissionPending.value = false;
    closeTextEditor();
    clearSelection();
  }

  return {
    enabled,
    selectedTarget,
    translationPreview,
    pendingTranslation,
    textEditorTarget,
    textDraft,
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
    openTextEditor,
    updateTextDraft,
    closeTextEditor,
    beginSubmit,
    commitSubmit,
    failSubmit,
    recordPresentedRevision,
    clearSelection,
    $reset,
  };
});
