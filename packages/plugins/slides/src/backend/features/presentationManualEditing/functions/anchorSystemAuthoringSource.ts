import type { DeckSpec, FreeformElement, StructuredElement } from '@plugin/slides/shared';
import { anchorAuthoringSource } from '../../../sandbox/authoringIdentity/index.js';

/** 既有全显式身份稿不增加标记；系统身份首次保存时一次固定调用点，保持队列 ref 不变。 */
export function anchorSystemAuthoringSource(source: string, deck: DeckSpec): string {
  function needsAnchor(node: FreeformElement | StructuredElement): boolean {
    const ref = node._authoringRef;
    return !!ref && (ref.editKey.startsWith('sysu_') || ref.editKey.startsWith('sysr_') || ref.slideKey.startsWith('sysp_'))
      || node.type === 'group' && (node.children ?? []).some(needsAnchor);
  }
  return deck.slides.some(slide => slide.spec.elements.some(needsAnchor))
    || deck.slides.every(slide => slide.spec.elements.length === 0)
    ? anchorAuthoringSource(source) : source;
}
