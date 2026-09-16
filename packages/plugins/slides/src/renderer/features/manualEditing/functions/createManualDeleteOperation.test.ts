import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { createManualDeleteOperation } from './createManualDeleteOperation';

function target(
  targetKind: ManualEditableTarget['targetKind'],
  capabilities: ManualEditableTarget['capabilities'],
): ManualEditableTarget {
  return {
    elementId: `authoring-overview-${targetKind}`,
    nodeKind: targetKind === 'text' ? 'text' : 'shape',
    targetKind,
    capabilities,
    authoringRef: { slideKey: 'overview', editKey: targetKind },
    authoringAncestorRefs: [],
    bounds: { x: 1, y: 1, w: 2, h: 1 },
    polygon: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 1, y: 2 }],
    translationElementIds: [`authoring-overview-${targetKind}`],
  };
}

describe('createManualDeleteOperation', () => {
  it('preserves the selected author target kind in the delete contract', () => {
    expect(createManualDeleteOperation(target('text', ['translate', 'delete']))).toEqual({
      op: 'delete_target',
      target: { slideKey: 'overview', editKey: 'text' },
      targetKind: 'text',
    });
    expect(createManualDeleteOperation(target('shape', ['translate']))).toBeNull();
  });
});
