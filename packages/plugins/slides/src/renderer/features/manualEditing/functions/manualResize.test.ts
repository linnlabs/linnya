import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { projectManualEditableTargetSelection, createManualVisualPreview } from './manualVisualPreview';
import { resolveManualResize } from './manualResize';

const target: ManualEditableTarget = {
  elementId: 'shape', nodeKind: 'shape', targetKind: 'shape',
  capabilities: ['translate', 'set_visual_size'],
  authoringRef: { slideKey: 'slide', editKey: 'shape' }, authoringAncestorRefs: [],
  translationElementIds: ['shape'], visualSize: { width: 2, height: 1 },
  bounds: { x: 1, y: 1, w: 2, h: 1 },
  polygon: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 1, y: 2 }],
};

describe('manual resize gestures', () => {
  it('resizes at zoom and starts a second resize from the still-pending visual size', () => {
    const operation = resolveManualResize({ target, handle: 'corner', clientX: 50, clientY: 50, renderScale: 0.5 }, 98, 74);
    expect(operation?.visualSize).toEqual({ width: 3, height: 1.5 });
    if (!operation) throw new Error('Missing resize operation');
    const preview = createManualVisualPreview(target, operation);
    if (!preview) throw new Error('Missing preview');
    const presented = projectManualEditableTargetSelection(target, new Map(), [preview]);
    expect(resolveManualResize({ target: presented, handle: 'right', clientX: 0, clientY: 0, renderScale: 1 }, 96, 0)?.visualSize)
      .toEqual({ width: 4, height: 1.5 });
  });

  it('uses local axes for a rotated shape and retains its fixed top-left anchor', () => {
    const rotated = { ...target, polygon: [{ x: 3, y: 1 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 1 }] };
    expect(resolveManualResize({ target: rotated, handle: 'right', clientX: 0, clientY: 0, renderScale: 1 }, 80, 96)?.visualSize)
      .toEqual({ width: 3, height: 1 });
    expect(rotated.polygon[0]).toEqual({ x: 3, y: 1 });
  });

  it('preserves image ratio on all handles and prevents crossing through zero size', () => {
    const image: ManualEditableTarget = { ...target, targetKind: 'image', nodeKind: 'image' };
    for (const handle of ['right', 'bottom', 'corner'] as const) {
      const start = { target: image, handle, clientX: 0, clientY: 0, renderScale: 1 };
      const size = resolveManualResize(start, 96, 96)?.visualSize;
      expect(size).toBeDefined();
      expect(size && size.width / size.height).toBe(2);
      expect(resolveManualResize(start, -960, -960)?.visualSize).toEqual({ width: 0.1, height: 0.05 });
    }
  });

  it('does not create edits for clicks, unchanged dimensions or unsupported targets', () => {
    const start = { target, handle: 'right' as const, clientX: 0, clientY: 0, renderScale: 1 };
    expect(resolveManualResize(start, 0, 96)).toBeNull();
    expect(resolveManualResize({ ...start, target: { ...target, capabilities: ['translate'] } }, 96, 0)).toBeNull();
  });
});
