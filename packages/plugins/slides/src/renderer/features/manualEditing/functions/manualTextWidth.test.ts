import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { canResizeTextWidth, resolveManualTextWidth } from './manualTextWidth';

const text: ManualEditableTarget = {
  elementId: 'title', nodeKind: 'text', targetKind: 'text', capabilities: ['translate', 'delete', 'set_text_content', 'set_text_style'],
  authoringRef: { slideKey: 'page', editKey: 'title' }, authoringAncestorRefs: [],
  bounds: { x: 1, y: 1, w: 4, h: 1 }, polygon: [], translationElementIds: ['title'],
};

describe('resolveManualTextWidth', () => {
  it('changes only the width from the right handle, in slide inches independent of zoom', () => {
    expect(canResizeTextWidth(text)).toBe(true);
    expect(resolveManualTextWidth(text, 'right', 96, 0.5)).toEqual({
      operation: { op: 'set_text_width', target: text.authoringRef, targetKind: 'text', width: 6 },
      bounds: { x: 1, y: 1, w: 6, h: 1 },
    });
  });

  it('keeps the right edge fixed from the left handle by moving and resizing in one write', () => {
    expect(resolveManualTextWidth(text, 'left', 96, 1)?.operation).toEqual({ op: 'batch', operations: [
      { op: 'translate_by', target: text.authoringRef, targetKind: 'text', delta: { dx: 1, dy: 0 } },
      { op: 'set_text_width', target: text.authoringRef, targetKind: 'text', width: 3 },
    ] });
    expect(resolveManualTextWidth(text, 'left', 2000, 1)?.bounds.w).toBe(0.3);
    expect(resolveManualTextWidth(text, 'right', 0, 1)).toBeNull();
  });
});
