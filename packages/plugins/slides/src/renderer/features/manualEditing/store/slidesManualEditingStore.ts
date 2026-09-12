import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type {
  ManualEditableTarget,
  ManualEditingTranslationPreview,
} from '../definitions/manualEditingTypes';

export const useSlidesManualEditingStore = defineStore('slides-manual-editing', () => {
  const enabled = ref(false);
  const selectedTarget = shallowRef<ManualEditableTarget | null>(null);
  const translationPreview = shallowRef<ManualEditingTranslationPreview | null>(null);
  const submitting = ref(false);
  const errorMessage = ref<string | null>(null);

  function setEnabled(value: boolean): void {
    enabled.value = value;
    if (!value) clearSelection();
  }

  function selectTarget(target: ManualEditableTarget | null): void {
    selectedTarget.value = target;
    translationPreview.value = null;
    errorMessage.value = null;
  }

  function setTranslationPreview(preview: ManualEditingTranslationPreview | null): void {
    translationPreview.value = preview;
  }

  function beginSubmit(): void {
    submitting.value = true;
    errorMessage.value = null;
  }

  function finishSubmit(error?: string): void {
    submitting.value = false;
    translationPreview.value = null;
    errorMessage.value = error ?? null;
  }

  function clearSelection(): void {
    selectedTarget.value = null;
    translationPreview.value = null;
  }

  function $reset(): void {
    enabled.value = false;
    submitting.value = false;
    errorMessage.value = null;
    clearSelection();
  }

  return {
    enabled,
    selectedTarget,
    translationPreview,
    submitting,
    errorMessage,
    setEnabled,
    selectTarget,
    setTranslationPreview,
    beginSubmit,
    finishSubmit,
    clearSelection,
    $reset,
  };
});
