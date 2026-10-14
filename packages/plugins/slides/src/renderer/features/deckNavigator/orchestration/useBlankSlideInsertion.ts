import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useSlidesStore } from '../../../store/slidesStore';
import { useSlidesRenderStore } from '../../../store/slidesRenderStore';
import {
  useSlidesManualEditingStore,
  type ManualEditSubmissionPort,
} from '../../manualEditing';
import type { BlankSlideInsertionAvailability } from '../definitions/deckNavigatorTypes';
import { resolveBlankSlideInsertion } from '../functions/blankSlideInsertion';

export interface BlankSlideInsertionController {
  readonly availability: ComputedRef<BlankSlideInsertionAvailability>;
  /** 已入队或正在提交的插入；页面插入一次只接纳一个，避免连续点击基于同一旧页序。 */
  readonly pending: ComputedRef<boolean>;
  readonly insertAfterCurrentSlide: () => Promise<void>;
}

/**
 * “+” 复用人工编辑的串行队列：同一精确修订 CAS、回执幂等、失败提示与画面结算。
 * 插入页呈现后才把它设为当前页，失败时停留在原页并由队列给出错误说明。
 */
export function useBlankSlideInsertion(
  submission: Pick<ManualEditSubmissionPort, 'enqueue'>,
): BlankSlideInsertionController {
  const slidesStore = useSlidesStore();
  const { currentDeckId, documentBuildState, currentSlideIndex } = storeToRefs(slidesStore);
  const { renderModel } = storeToRefs(useSlidesRenderStore());
  const manualEditingStore = useSlidesManualEditingStore();

  const availability = computed(() => resolveBlankSlideInsertion({
    documentId: currentDeckId.value,
    buildState: documentBuildState.value,
    renderModel: renderModel.value,
    currentSlideIndex: currentSlideIndex.value,
  }));

  const pending = computed(() => {
    const active = manualEditingStore.submission;
    return manualEditingStore.queue.some(entry => entry.intent.operation.op === 'insert_blank_slide')
      || (active.phase !== 'idle' && active.entry.intent.operation.op === 'insert_blank_slide');
  });

  async function insertAfterCurrentSlide(): Promise<void> {
    const current = availability.value;
    if (!current.available || pending.value) return;
    const documentId = currentDeckId.value;
    const ticket = submission.enqueue({ operation: { op: 'insert_blank_slide', index: current.index } });
    const settlement = await ticket.settled;
    if (settlement.status === 'presented' && currentDeckId.value === documentId) {
      slidesStore.setCurrentSlide(current.index);
    }
  }

  return { availability, pending, insertAfterCurrentSlide };
}
