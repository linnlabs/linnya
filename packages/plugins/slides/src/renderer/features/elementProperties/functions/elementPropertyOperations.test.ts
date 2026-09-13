import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../../manualEditing';
import {
  createDeleteFrameOperation,
  createFillColorOperation,
  createTextStyleOperation,
  createVisualSizeOperation,
  resolveVisualSizeAfterDimensionChange,
} from './elementPropertyOperations';

function target(
  targetKind: ManualEditableTarget['targetKind'],
  capabilities: ManualEditableTarget['capabilities'],
): ManualEditableTarget {
  return {
    elementId: `authoring-overview-${targetKind}`,
    nodeKind: targetKind === 'text' ? 'text' : targetKind === 'image' ? 'image' : 'shape',
    targetKind,
    capabilities,
    authoringRef: { slideKey: 'overview', editKey: targetKind },
    authoringAncestorRefs: [],
    bounds: { x: 1, y: 1, w: 2, h: 1 },
    polygon: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 1, y: 2 }],
    translationElementIds: [`authoring-overview-${targetKind}`],
  };
}

describe('element property operations', () => {
  it('creates only text style operations supported by the compiler projection', () => {
    const text = target('text', ['translate', 'set_text_style']);
    expect(createTextStyleOperation(text, { fontSizePt: 28 })).toEqual({
      op: 'set_text_style',
      target: { slideKey: 'overview', editKey: 'text' },
      fontSizePt: 28,
    });
    expect(createTextStyleOperation(text, { color: '#2563EB' })).toEqual(expect.objectContaining({
      color: '#2563EB',
    }));
    expect(createTextStyleOperation(text, { fontSizePt: 0 })).toBeNull();
    expect(createTextStyleOperation(text, { fontSizePt: 401 })).toBeNull();
    expect(createTextStyleOperation(text, { color: 'blue' })).toBeNull();
    expect(createTextStyleOperation(target('text', ['translate']), { fontSizePt: 28 })).toBeNull();
  });

  it('keeps fill and visual-size operations within their authoring target kinds', () => {
    expect(createFillColorOperation(target('frame', ['set_fill_color']), '#DC2626')).toEqual({
      op: 'set_fill_color',
      target: { slideKey: 'overview', editKey: 'frame' },
      targetKind: 'frame',
      color: '#DC2626',
    });
    expect(createFillColorOperation(target('image', ['set_fill_color']), '#DC2626')).toBeNull();
    expect(createFillColorOperation(target('shape', ['set_fill_color']), '#fff')).toBeNull();

    expect(createVisualSizeOperation(target('image', ['set_visual_size']), {
      width: 3.5,
      height: 2,
    })).toEqual(expect.objectContaining({
      op: 'set_visual_size',
      targetKind: 'image',
      visualSize: { width: 3.5, height: 2 },
    }));
    expect(createVisualSizeOperation(target('frame', ['set_visual_size']), {
      width: 3.5,
      height: 2,
    })).toBeNull();
    expect(createVisualSizeOperation(target('shape', ['set_visual_size']), {
      width: Number.NaN,
      height: 2,
    })).toBeNull();
  });

  it('exposes destructive deletion only for a projected Frame', () => {
    expect(createDeleteFrameOperation(target('frame', ['delete']))).toEqual({
      op: 'delete_target',
      target: { slideKey: 'overview', editKey: 'frame' },
      targetKind: 'frame',
    });
    expect(createDeleteFrameOperation(target('shape', ['delete']))).toBeNull();
    expect(createDeleteFrameOperation(target('frame', ['translate']))).toBeNull();
  });

  it('preserves the committed image aspect ratio when either dimension changes', () => {
    expect(resolveVisualSizeAfterDimensionChange('image', { width: 4, height: 2 }, 'width', 6))
      .toEqual({ width: 6, height: 3 });
    expect(resolveVisualSizeAfterDimensionChange('image', { width: 4, height: 2 }, 'height', 3))
      .toEqual({ width: 6, height: 3 });
    expect(resolveVisualSizeAfterDimensionChange('shape', { width: 4, height: 2 }, 'width', 6))
      .toEqual({ width: 6, height: 2 });
    expect(resolveVisualSizeAfterDimensionChange('image', { width: 0, height: 2 }, 'width', 6))
      .toBeNull();
  });
});
