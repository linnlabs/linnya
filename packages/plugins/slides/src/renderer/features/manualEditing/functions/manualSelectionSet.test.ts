import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { collectManualMarqueeSelection } from './manualSelectionSet';

function target(editKey: string, bounds: ManualEditableTarget['bounds'], parent?: string): ManualEditableTarget {
  return {
    elementId: editKey, nodeKind: 'shape', targetKind: parent ? 'text' : 'frame', capabilities: ['translate'],
    authoringRef: { slideKey: 'page', editKey },
    authoringAncestorRefs: parent ? [{ slideKey: 'page', editKey: parent, targetKind: 'frame' }] : [],
    bounds, polygon: [], translationElementIds: [editKey],
  };
}

const card = target('card', { x: 1, y: 1, w: 3, h: 3 });
const title = target('title', { x: 1.2, y: 1.2, w: 1, h: 0.4 }, 'card');
const body = target('body', { x: 1.2, y: 2, w: 2, h: 1 }, 'card');
const other = target('other', { x: 5, y: 1, w: 1, h: 1 });

describe('collectManualMarqueeSelection', () => {
  it('selects only fully enclosed objects, descending into a card the marquee does not cover', () => {
    const inside = collectManualMarqueeSelection([card, title, body, other], { x: 1.1, y: 1.1, w: 2.5, h: 2 }, []);
    expect(inside.map(entry => entry.elementId)).toEqual(['title', 'body']);
  });

  it('keeps the outer card when it is enclosed, and ignores objects the marquee only touches', () => {
    const all = collectManualMarqueeSelection([card, title, body, other], { x: 0.5, y: 0.5, w: 5, h: 4 }, []);
    expect(all.map(entry => entry.elementId)).toEqual(['card']);
  });
});
