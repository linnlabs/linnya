import type { DeckSpec, FreeformElement, SlidesAuthoringEditRef, SlidesManualEditCommandOperation, StructuredElement } from '@plugin/slides/shared';
import type { ManualEditHistoryFocus } from '../definitions/manualEditHistory.js';

/** 记录一次编辑影响的页与对象；只读编辑前文稿，越界页序由 Renderer 按呈现结果收敛。 */
export function describeManualEditHistoryFocus(deck: DeckSpec, operation: SlidesManualEditCommandOperation): ManualEditHistoryFocus | undefined {
  switch (operation.op) {
    case 'undo':
    case 'redo':
      return undefined;
    case 'insert_blank_slide':
      return { beforeSlideIndex: Math.max(operation.index - 1, 0), afterSlideIndex: operation.index, targets: [] };
    case 'duplicate_slide':
      return { beforeSlideIndex: operation.index, afterSlideIndex: operation.index + 1, targets: [] };
    case 'delete_slide':
      return { beforeSlideIndex: operation.index, afterSlideIndex: operation.index, targets: [] };
    case 'move_slide':
      return { beforeSlideIndex: operation.index, afterSlideIndex: operation.toIndex, targets: [] };
    case 'insert_objects': {
      const slideKey = readSlideKey(deck, operation.index);
      return { beforeSlideIndex: operation.index, afterSlideIndex: operation.index,
        targets: slideKey ? operation.objects.map(object => ({ slideKey, editKey: object.editKey })) : [] };
    }
    case 'batch':
      return describeTargets(deck, operation.operations.map(entry => entry.target));
    default:
      return describeTargets(deck, [operation.target]);
  }
}

function describeTargets(deck: DeckSpec, targets: readonly SlidesAuthoringEditRef[]): ManualEditHistoryFocus | undefined {
  const slideKey = targets[0]?.slideKey;
  const slideIndex = deck.slides.findIndex(slide => collectRefs(slide.spec.elements).some(ref => ref.slideKey === slideKey));
  if (slideIndex < 0) return undefined;
  const refs = targets.map(target => ({ slideKey: target.slideKey, editKey: target.editKey }));
  return { beforeSlideIndex: slideIndex, afterSlideIndex: slideIndex, targets: refs };
}

function readSlideKey(deck: DeckSpec, index: number): string | undefined {
  const slide = deck.slides[index];
  return slide ? collectRefs(slide.spec.elements)[0]?.slideKey : undefined;
}

function collectRefs(elements: readonly (FreeformElement | StructuredElement)[]): SlidesAuthoringEditRef[] {
  return elements.flatMap(element => [
    ...(element._authoringRef ? [element._authoringRef] : []),
    ...(element.type === 'group' ? collectRefs(element.children ?? []) : []),
  ]);
}
