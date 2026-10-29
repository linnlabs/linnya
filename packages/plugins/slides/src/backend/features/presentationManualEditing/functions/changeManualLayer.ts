import type { DeckSpec, SlidesAuthoringEditRef, FreeformElement, StructuredElement } from '@plugin/slides/shared';
import { collectManualAuthoringTargets } from './collectManualAuthoringTargets';
import { writePaintOrderToDeckSource, SlidesManualEditSourceError } from './writeManualEditsToDeckSource';

/** 只在同一作者父级内排序；Frame 作为整体，不重排内部 Flex 布局。 */
export function changeManualLayer(source: string, deck: DeckSpec, target: SlidesAuthoringEditRef, direction: 'front' | 'back' | 'forward' | 'backward'): string {
  const matches = collectManualAuthoringTargets(deck, target); const current = matches[0];
  if (matches.length !== 1 || !current) throw new SlidesManualEditSourceError('operation_invalid', '图层目标已失效。');
  const ancestry = JSON.stringify(current.element._authoringAncestorRefs ?? []);
  const peers: string[] = [];
  function visit(element: FreeformElement | StructuredElement): void {
    if (element._authoringRef?.slideKey === target.slideKey && JSON.stringify(element._authoringAncestorRefs ?? []) === ancestry) peers.push(element._authoringRef.editKey);
    if (element.type === 'group') (element.children ?? []).forEach(visit);
  }
  deck.slides.forEach(slide => slide.spec.elements.forEach(visit));
  const keys = [...new Set(peers)]; const index = keys.indexOf(target.editKey);
  const to = direction === 'front' ? keys.length - 1 : direction === 'back' ? 0 : Math.max(0, Math.min(keys.length - 1, index + (direction === 'forward' ? 1 : -1)));
  keys.splice(index, 1); keys.splice(to, 0, target.editKey);
  return writePaintOrderToDeckSource(source, target.slideKey, keys);
}
