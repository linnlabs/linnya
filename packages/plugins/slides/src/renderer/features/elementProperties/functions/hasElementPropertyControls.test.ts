import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../../manualEditing';
import { hasElementPropertyControls } from './hasElementPropertyControls';

function createTarget(
  capabilities: ManualEditableTarget['capabilities'],
): ManualEditableTarget {
  return {
    elementId: 'authoring-overview-title',
    nodeKind: 'text',
    targetKind: 'text',
    capabilities,
    authoringRef: { slideKey: 'overview', editKey: 'title' },
    authoringAncestorRefs: [],
    bounds: { x: 1, y: 1, w: 3, h: 1 },
    polygon: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 1, y: 2 },
    ],
    translationElementIds: ['authoring-overview-title'],
  };
}

describe('hasElementPropertyControls', () => {
  it('does not create an empty panel for move-only targets', () => {
    expect(hasElementPropertyControls(createTarget(['translate']))).toBe(false);
  });

  it('shows controls when the target exposes an editable property', () => {
    expect(hasElementPropertyControls(createTarget(['translate', 'set_text_style']))).toBe(true);
  });
});
