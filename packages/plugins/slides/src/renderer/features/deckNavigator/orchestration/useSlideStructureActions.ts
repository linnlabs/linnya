import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useSlidesStore } from '../../documentRuntime';
import { useSlidesRenderStore } from '../../../store/slidesRenderStore';
import { useSlidesManualSubmissionStore, type ManualEditSubmissionPort } from '../../manualEditing/submission';
import type { BlankSlideInsertionAvailability } from '../definitions/deckNavigatorTypes';
import { resolveBlankSlideInsertion } from '../functions/blankSlideInsertion';

export interface SlideStructureActions {
  readonly availability: ComputedRef<BlankSlideInsertionAvailability>;
  /** 已入队或正在提交的页面操作；一次只接纳一个，避免连续点击基于同一旧页序。 */
  readonly pending: ComputedRef<boolean>;
  readonly insertAfterCurrentSlide: () => Promise<void>;
  readonly duplicateSlide: (index: number) => Promise<void>;
  readonly moveSlide: (index: number, toIndex: number) => Promise<void>;
  readonly deleteSlide: (index: number) => Promise<void>;
  readonly canDelete: ComputedRef<boolean>;
}

/**
 * “+” 复用人工编辑的串行队列：同一精确修订 CAS、回执幂等、失败提示与画面结算。
 * 提交修订装入后直接切到目标页，等待该页呈现；失败时停留在原页并由队列解释。
 */
export function useSlideStructureActions(
  submission: Pick<ManualEditSubmissionPort, 'enqueue'>,
): SlideStructureActions {
  const slidesStore = useSlidesStore();
  const { currentDeckId, documentBuildState, currentSlideIndex } = storeToRefs(slidesStore);
  const { renderModel } = storeToRefs(useSlidesRenderStore());
  const manualEditingStore = useSlidesManualSubmissionStore();

  const availability = computed(() => resolveBlankSlideInsertion({
    documentId: currentDeckId.value,
    buildState: documentBuildState.value,
    renderModel: renderModel.value,
    currentSlideIndex: currentSlideIndex.value,
  }));

  const pending = computed(() => manualEditingStore.pendingPageOperation);

  const canDelete = computed(() => availability.value.available && !pending.value && (renderModel.value?.slides.length ?? 0) > 1);

  async function submitStructure(op: 'insert_blank_slide' | 'duplicate_slide' | 'delete_slide', index: number): Promise<void> {
    if (!availability.value.available || pending.value || (op === 'delete_slide' && !canDelete.value)) return;
    const ticket = submission.enqueue({ operation: { op, index } });
    await ticket.settled;
  }

  async function insertAfterCurrentSlide(): Promise<void> {
    const current = availability.value;
    if (current.available) await submitStructure('insert_blank_slide', current.index);
  }

  return {
    availability, pending, canDelete, insertAfterCurrentSlide,
    moveSlide: async (index, toIndex) => {
      if (!availability.value.available || pending.value || index === toIndex || toIndex < 0 || toIndex >= (renderModel.value?.slides.length ?? 0)) return;
      await submission.enqueue({ operation: { op: 'move_slide', index, toIndex } }).settled;
    },
    duplicateSlide: (index: number) => submitStructure('duplicate_slide', index),
    deleteSlide: (index: number) => submitStructure('delete_slide', index),
  };
}
