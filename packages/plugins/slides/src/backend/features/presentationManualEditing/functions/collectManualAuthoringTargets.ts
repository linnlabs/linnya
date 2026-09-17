import type { DeckSpec, FreeformElement, StructuredElement, SlidesAuthoringEditRef, SlidesAuthoringObjectRef } from '@plugin/slides/shared';

interface ManualAuthoringTarget {
  readonly ref: SlidesAuthoringObjectRef;
  readonly element: FreeformElement | StructuredElement;
  readonly isTopLevel: boolean;
}

/** 作者身份只来自当前 DeckSpec 的正式投影；嵌套 group 不能按顶层或视觉位置猜测。 */
export function collectManualAuthoringTargets(deckSpec: DeckSpec, target: SlidesAuthoringEditRef): ManualAuthoringTarget[] {
  const matches: ManualAuthoringTarget[] = [];
  function visit(element: FreeformElement | StructuredElement, isTopLevel: boolean): void {
    const ref = element._authoringRef;
    if (ref?.slideKey === target.slideKey && ref.editKey === target.editKey) matches.push({ ref, element, isTopLevel });
    if (element.type === 'group') for (const child of element.children ?? []) visit(child, false);
  }
  for (const slide of deckSpec.slides) for (const element of slide.spec.elements) visit(element, true);
  return matches;
}
