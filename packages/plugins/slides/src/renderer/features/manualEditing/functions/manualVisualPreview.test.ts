import { projectEditingPreviewNode, collectEditingPreviewGeometries } from '../../editingPreview';
import { describe, expect, it } from 'vitest';
import type { RenderNode } from '../../../types/render';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import {
  createManualVisualPreview,
  projectManualEditableTargetSelection,
} from './manualVisualPreview';

function target(targetKind: ManualEditableTarget['targetKind']): ManualEditableTarget {
  const selectionPolygon = [
    { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 1, y: 2 },
  ];
  return {
    elementId: `authoring-overview-${targetKind}`,
    nodeKind: targetKind === 'text' ? 'text' : targetKind === 'image' ? 'image' : 'shape',
    targetKind,
    capabilities: ['translate'],
    authoringRef: { slideKey: 'overview', editKey: targetKind },
    authoringAncestorRefs: [],
    bounds: { x: 1, y: 1, w: 2, h: 1 },
    polygon: selectionPolygon,
    ...(targetKind === 'frame'
      ? {
          frameSelectionFragments: [
            { elementId: 'authoring-overview-frame', polygon: selectionPolygon },
            {
              elementId: 'authoring-overview-child',
              polygon: [
                { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 },
              ],
            },
          ],
        }
      : {}),
    translationElementIds: [`authoring-overview-${targetKind}`, 'authoring-overview-child'],
  };
}

describe('manual visual preview', () => {
  it('keeps a complete prior frame when measurement facts are unavailable', () => {
    const selected = target('text');
    const preview = createManualVisualPreview(selected, {
      op: 'set_text_style',
      target: selected.authoringRef,
      fontSizePt: 30,
      color: '#2563EB',
    });
    const node: RenderNode = {
      id: selected.elementId,
      kind: 'text',
      box: { x: 1, y: 1, w: 2, h: 1, unit: 'in' },
      zIndex: 1,
      paragraphs: [{ runs: [{ text: 'A', fontSize: 14 }, { text: 'B', color: '#000000' }] }],
    };

    expect(projectEditingPreviewNode(node, preview ? [preview] : [])).toBe(node);
  });

  it('projects shape fill and image size locally while waiting for compilation', () => {
    const shape = target('shape');
    const shapeNode: RenderNode = {
      id: shape.elementId,
      kind: 'shape',
      box: { x: 1, y: 1, w: 2, h: 1, unit: 'in' },
      zIndex: 1,
      geometry: { type: 'preset', name: 'rect' },
      fill: { type: 'solid', color: '#000000' },
    };
    const fillPreview = createManualVisualPreview(shape, {
      op: 'set_fill_color',
      target: shape.authoringRef,
      targetKind: 'shape',
      color: '#16A34A',
    });
    expect(projectEditingPreviewNode(
      shapeNode,
      fillPreview ? [fillPreview] : [],
    )).toMatchObject({
      fill: { type: 'solid', color: '#16A34A' },
    });

    const image = target('image');
    const imageNode: RenderNode = {
      id: image.elementId,
      kind: 'image',
      box: { x: 1, y: 1, w: 2, h: 1, unit: 'in' },
      zIndex: 1,
      asset: { type: 'url', value: 'asset://hero' },
    };
    const sizePreview = createManualVisualPreview(image, {
      op: 'set_visual_size',
      target: image.authoringRef,
      targetKind: 'image',
      visualSize: { width: 4, height: 2.5 },
    });
    expect(projectEditingPreviewNode(
      imageNode,
      sizePreview ? [sizePreview] : [],
    )).toMatchObject({
      box: { x: 1, y: 1, w: 4, h: 2.5, unit: 'in' },
    });
    expect(projectManualEditableTargetSelection(
      image, new Map(),
      collectEditingPreviewGeometries([imageNode], sizePreview ? [sizePreview] : []),
    ).polygon).toEqual([
      { x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 3.5 }, { x: 1, y: 3.5 },
    ]);
  });

  it('hides every flattened render root belonging to a deleted Frame', () => {
    const frame = target('frame');
    const preview = createManualVisualPreview(frame, {
      op: 'delete_target',
      target: frame.authoringRef,
      targetKind: 'frame',
    });
    const child: RenderNode = {
      id: 'authoring-overview-child',
      kind: 'shape',
      box: { x: 2, y: 2, w: 1, h: 1, unit: 'in' },
      zIndex: 2,
      geometry: { type: 'preset', name: 'rect' },
    };
    const unrelated: RenderNode = { ...child, id: 'authoring-overview-unrelated' };

    const previews = preview ? [preview] : [];
    expect(projectEditingPreviewNode(child, previews).visible).toBe(false);
    expect(projectEditingPreviewNode(unrelated, previews)).toBe(unrelated);
  });

  it('expands a Frame selection around a child moved beyond its background', () => {
    const frame = target('frame');
    const projected = projectManualEditableTargetSelection(
      frame,
      new Map([[
        'authoring-overview-child',
        { dx: 4, dy: 0 },
      ]]),
      new Map(frame.frameSelectionFragments?.map(fragment => [fragment.elementId, {
        ...fragment, nodeKind: 'shape', zPath: [], bounds: frame.bounds,
        node: { id: fragment.elementId, kind: 'shape', box: { ...frame.bounds, unit: 'in' }, zIndex: 0, geometry: { type: 'preset', name: 'rect' } },
      }])),
    );

    expect(projected).toMatchObject({
      bounds: { x: 1, y: 1, w: 6, h: 2 },
      polygon: [
        { x: 1, y: 1 },
        { x: 7, y: 1 },
        { x: 7, y: 3 },
        { x: 1, y: 3 },
      ],
    });
  });

  it('rejects a preview when the operation targets a different authoring object', () => {
    const image = target('image');
    expect(createManualVisualPreview(image, {
      op: 'set_visual_size',
      target: { slideKey: 'overview', editKey: 'other' },
      targetKind: 'image',
      visualSize: { width: 2, height: 2 },
    })).toBeNull();
  });
});
