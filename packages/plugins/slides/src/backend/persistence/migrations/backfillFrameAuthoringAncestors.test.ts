import { describe, expect, it } from 'vitest';
import { backfillFrameAuthoringAncestors } from './backfillFrameAuthoringAncestors';

function element(
  editKey: string,
  targetKind: 'frame' | 'shape' | 'text',
  layoutNodeId: string,
): Record<string, unknown> {
  return {
    type: targetKind === 'text' ? 'text' : 'shape',
    _authoringRef: { slideKey: 'overview', editKey, targetKind },
    _layoutConstraintEvidence: { layoutNodeId },
  };
}

describe('backfillFrameAuthoringAncestors', () => {
  it('把旧 Flex 层级一次性迁移为外到内的 Frame 作者祖先', () => {
    const outer = element('section', 'frame', 'layout:s1:root.0');
    const inner = element('card1', 'frame', 'layout:s1:root.0.1');
    const child = element('card1Label', 'text', 'layout:s1:root.0.1.0');
    const sibling = element('footer', 'text', 'layout:s1:root.2');
    const deckSpec = {
      slides: [{ spec: { elements: [outer, inner, child, sibling] } }],
    };

    expect(backfillFrameAuthoringAncestors(deckSpec)).toBe(true);
    expect(outer._authoringAncestorRefs).toBeUndefined();
    expect(inner._authoringAncestorRefs).toEqual([
      { slideKey: 'overview', editKey: 'section', targetKind: 'frame' },
    ]);
    expect(child._authoringAncestorRefs).toEqual([
      { slideKey: 'overview', editKey: 'section', targetKind: 'frame' },
      { slideKey: 'overview', editKey: 'card1', targetKind: 'frame' },
    ]);
    expect(sibling._authoringAncestorRefs).toBeUndefined();
    expect(backfillFrameAuthoringAncestors(deckSpec)).toBe(false);
  });
});
