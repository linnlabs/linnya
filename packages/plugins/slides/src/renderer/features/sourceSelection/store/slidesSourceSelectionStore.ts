import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { SourceSelectionMarquee } from '../definitions/sourceSelectionTypes';
import { normalizeSourceSelectionIds } from '../functions/sourceSelectionState';

export const useSlidesSourceSelectionStore = defineStore('slides-source-selection', () => {
  const selectedElementIds = ref<string[]>([]);
  const hoveredElementId = ref<string | null>(null);
  const marqueeDraft = ref<SourceSelectionMarquee | null>(null);

  const hasSelection = computed(() => selectedElementIds.value.length > 0);
  const selectedElementIdSet = computed(() => new Set(selectedElementIds.value));

  function setSelectedElementIds(elementIds: readonly string[]): void {
    selectedElementIds.value = normalizeSourceSelectionIds(elementIds);
  }

  function clearSelection(): void {
    selectedElementIds.value = [];
  }

  function setHoveredElementId(elementId: string | null): void {
    hoveredElementId.value = elementId;
  }

  function setMarqueeDraft(draft: SourceSelectionMarquee | null): void {
    marqueeDraft.value = draft;
  }

  function $reset(): void {
    clearSelection();
    hoveredElementId.value = null;
    marqueeDraft.value = null;
  }

  return {
    selectedElementIds,
    hoveredElementId,
    marqueeDraft,
    hasSelection,
    selectedElementIdSet,
    setSelectedElementIds,
    clearSelection,
    setHoveredElementId,
    setMarqueeDraft,
    $reset,
  };
});
