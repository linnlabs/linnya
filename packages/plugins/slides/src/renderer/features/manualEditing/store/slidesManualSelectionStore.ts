import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import type { ManualEditableTarget, ManualEditingTranslationPreview, ManualEditRevealRequest } from '../definitions/manualEditingTypes';

/** 选择与瞬时手势独立于写队列；待保存、只读和失败均不夺走用户的选区。 */
export const useSlidesManualSelectionStore = defineStore('slides-manual-selection', () => {
  const selectedTargets = shallowRef<readonly ManualEditableTarget[]>([]);
  const selectedTarget = computed(() => selectedTargets.value[selectedTargets.value.length - 1] ?? null);
  const selectionPath = shallowRef<readonly ManualEditableTarget[]>([]);
  const translationPreview = shallowRef<ManualEditingTranslationPreview | null>(null);
  /** 撤销、插入或粘贴呈现后要在当前页选中的作者对象；由画布交互解析成目标后清空。 */
  const revealRequest = shallowRef<ManualEditRevealRequest | null>(null);
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

  function clearSelection(): void {
    selectedTargets.value = [];
    selectionPath.value = [];
    translationPreview.value = null;
  }

  function $reset(): void { clearSelection(); revealRequest.value = null; }
  return { selectedTargets, selectedTarget, selectionPath, translationPreview, revealRequest,
    selectTarget, reconcileSelectedTarget, selectTargets, requestReveal, setTranslationPreview, clearSelection, $reset };
});
