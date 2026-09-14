import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { resolveManualClickSelection } from './resolveManualClickSelection';

function createTarget(elementId: string, targetKind: ManualEditableTarget['targetKind']): ManualEditableTarget {
  return {
    elementId,
    nodeKind: targetKind === 'frame' ? 'shape' : 'text',
    targetKind,
    capabilities: ['translate'],
    authoringRef: { slideKey: 'overview', editKey: elementId },
    authoringAncestorRefs: [],
    bounds: { x: 0, y: 0, w: 1, h: 1 },
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    translationElementIds: [elementId],
  };
}

const root = createTarget('root', 'frame');
const groupA = createTarget('group-a', 'frame');
const groupB = createTarget('group-b', 'frame');
const childA = createTarget('child-a', 'text');
const childB = createTarget('child-b', 'text');

describe('resolveManualClickSelection', () => {
  it('enters the next child when clicking inside the selected path', () => {
    expect(resolveManualClickSelection(
      [root, childA],
      [root, childA],
      root.elementId,
    )).toEqual({ target: root, clickTarget: childA });
  });

  it('switches directly between children of the same Frame', () => {
    expect(resolveManualClickSelection(
      [root, childB],
      [root, childA],
      childA.elementId,
    )).toEqual({ target: childB, clickTarget: childB });
  });

  it('stops at the new branch Frame when switching nested branches', () => {
    expect(resolveManualClickSelection(
      [root, groupB, childB],
      [root, groupA, childA],
      childA.elementId,
    )).toEqual({ target: groupB, clickTarget: groupB });
  });

  it('starts from the outermost target for an unrelated path', () => {
    expect(resolveManualClickSelection(
      [groupB, childB],
      [root, childA],
      childA.elementId,
    )).toEqual({ target: groupB, clickTarget: groupB });
  });
});
