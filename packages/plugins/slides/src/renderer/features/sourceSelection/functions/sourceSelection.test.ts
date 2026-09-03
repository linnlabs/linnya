import { describe, expect, it } from 'vitest';
import type {
  GroupRenderNode,
  RenderBox,
  RenderNode,
  RenderSourceSpan,
  ShapeRenderNode,
  TextRenderNode,
} from '../../../types/render';
import {
  collectSourceElementsInRect,
  findSourceElementAtPoint,
} from './renderNodeSourceSelection';
import { resolveSourceSelectionAvailability } from './sourceSelectionAvailability';
import {
  resolveSourceElementClickSelection,
  resolveSourceMarqueeSelection,
} from './sourceSelectionState';
import { resolveSourceSelectionPromptPosition } from './sourceSelectionPromptPosition';

const SPAN_1: RenderSourceSpan = { startLine: 1, endLine: 1 };
const SPAN_2: RenderSourceSpan = { startLine: 2, endLine: 4 };

function box(input: Omit<RenderBox, 'unit'>): RenderBox {
  return { ...input, unit: 'in' };
}

function shape(
  id: string,
  shapeBox: RenderBox,
  zIndex: number,
  sourceSpan?: RenderSourceSpan,
  options: { rotation?: number; visible?: boolean } = {},
): ShapeRenderNode {
  return {
    id,
    kind: 'shape',
    box: shapeBox,
    zIndex,
    geometry: { type: 'preset', name: 'rect' },
    sourceSpan,
    rotation: options.rotation,
    visible: options.visible ?? true,
  };
}

function text(
  id: string,
  textBox: RenderBox,
  zIndex: number,
  sourceSpan?: RenderSourceSpan,
): TextRenderNode {
  return {
    id,
    kind: 'text',
    box: textBox,
    zIndex,
    sourceSpan,
    paragraphs: [
      {
        runs: [{ text: 'Quarterly growth' }],
      },
    ],
  };
}

function group(
  id: string,
  groupBox: RenderBox,
  zIndex: number,
  children: readonly RenderNode[],
  sourceSpan?: RenderSourceSpan,
  options: { rotation?: number; visible?: boolean } = {},
): GroupRenderNode {
  return {
    id,
    kind: 'group',
    box: groupBox,
    zIndex,
    children: [...children],
    sourceSpan,
    rotation: options.rotation,
    visible: options.visible ?? true,
  };
}

describe('sourceSelection render-node functions', () => {
  it('hit-tests the topmost source-backed element and ignores synthetic inner nodes', () => {
    const nodes: RenderNode[] = [
      shape('bottom', box({ x: 0, y: 0, w: 4, h: 4 }), 1, SPAN_1),
      shape('top-inner', box({ x: 1, y: 1, w: 2, h: 2 }), 3, SPAN_2),
      shape('top-without-source', box({ x: 1, y: 1, w: 2, h: 2 }), 2),
    ];

    const hit = findSourceElementAtPoint(nodes, { x: 1.5, y: 1.5 });

    expect(hit?.elementId).toBe('bottom');
    expect(hit?.sourceSpan).toEqual(SPAN_1);
  });

  it('uses group-relative child coordinates when hit-testing and building overlay polygons', () => {
    const nodes: RenderNode[] = [
      group(
        'group',
        box({ x: 1, y: 1, w: 4, h: 3 }),
        0,
        [
          shape('child', box({ x: 0.5, y: 0.5, w: 1, h: 1 }), 1, SPAN_1),
        ],
      ),
    ];

    const hit = findSourceElementAtPoint(nodes, { x: 1.75, y: 1.75 });

    expect(hit?.elementId).toBe('child');
    expect(hit?.polygon[0]?.x).toBeCloseTo(1.5);
    expect(hit?.polygon[0]?.y).toBeCloseTo(1.5);
  });

  it('falls back to the source-backed group when the child has no source span', () => {
    const nodes: RenderNode[] = [
      group(
        'source-group',
        box({ x: 1, y: 1, w: 4, h: 3 }),
        0,
        [
          shape('visual-child', box({ x: 0.5, y: 0.5, w: 1, h: 1 }), 1),
        ],
        SPAN_1,
      ),
    ];

    const hit = findSourceElementAtPoint(nodes, { x: 1.75, y: 1.75 });

    expect(hit?.elementId).toBe('source-group');
  });

  it('applies node rotation during hit-testing', () => {
    const nodes: RenderNode[] = [
      shape('rotated', box({ x: 1, y: 1, w: 2, h: 1 }), 0, SPAN_1, { rotation: 90 }),
    ];

    expect(findSourceElementAtPoint(nodes, { x: 0.5, y: 1.5 })?.elementId).toBe('rotated');
    expect(findSourceElementAtPoint(nodes, { x: 1.5, y: 0.5 })).toBeNull();
  });

  it('collects source-backed elements intersecting a marquee rectangle', () => {
    const nodes: RenderNode[] = [
      shape('inside', box({ x: 1, y: 1, w: 1, h: 1 }), 1, SPAN_1),
      shape('outside', box({ x: 4, y: 4, w: 1, h: 1 }), 2, SPAN_2),
    ];

    const hits = collectSourceElementsInRect(nodes, { x: 0.5, y: 0.5, w: 2, h: 2 });

    expect(hits.map((hit) => hit.elementId)).toEqual(['inside']);
  });

  it('adds a lightweight readable summary for source-backed targets', () => {
    const hit = findSourceElementAtPoint(
      [text('title', box({ x: 1, y: 1, w: 3, h: 1 }), 1, SPAN_1)],
      { x: 1.5, y: 1.5 },
    );

    expect(hit?.summary).toBe('text="Quarterly growth"');
  });
});

describe('sourceSelection availability', () => {
  it('reports why source selection mode cannot be enabled', () => {
    const slide = {
      slideId: 's1',
      index: 0,
      layoutKey: 'freeform',
      background: {},
      elements: [
        shape('a', box({ x: 0, y: 0, w: 1, h: 1 }), 0),
      ],
    };

    const availability = resolveSourceSelectionAvailability({
      renderModel: {
        presentationId: 'deck-1',
        title: 'Deck',
        version: 1,
        sourceKind: 'generated',
        slideSize: { width: 10, height: 5.625, unit: 'in' },
        slides: [slide],
        capabilities: {
          hasSemanticRender: true,
          hasReferencePreview: false,
          hasHitTest: true,
          hasSelection: true,
          canEditSourceSelection: true,
        },
      },
      currentSlideRender: slide,
      currentSlideKonvaCompatible: true,
    });

    expect(availability.canEnableMode).toBe(false);
    expect(availability.reason).toBe('no-source-backed-elements');
    expect(availability.selectableElementCount).toBe(0);
  });

  it('allows source selection mode when the current Konva slide has source-backed elements', () => {
    const slide = {
      slideId: 's1',
      index: 0,
      layoutKey: 'freeform',
      background: {},
      elements: [
        shape('a', box({ x: 0, y: 0, w: 1, h: 1 }), 0, SPAN_1),
      ],
    };

    const availability = resolveSourceSelectionAvailability({
      renderModel: {
        presentationId: 'deck-1',
        title: 'Deck',
        version: 1,
        sourceKind: 'generated',
        slideSize: { width: 10, height: 5.625, unit: 'in' },
        slides: [slide],
        capabilities: {
          hasSemanticRender: true,
          hasReferencePreview: false,
          hasHitTest: true,
          hasSelection: true,
          canEditSourceSelection: true,
        },
      },
      currentSlideRender: slide,
      currentSlideKonvaCompatible: true,
    });

    expect(availability.canEnableMode).toBe(true);
    expect(availability.reason).toBeNull();
    expect(availability.selectableElementCount).toBe(1);
  });
});

describe('sourceSelection prompt position', () => {
  it('positions the prompt below the selected target in viewport coordinates', () => {
    const target = findSourceElementAtPoint(
      [shape('near-top', box({ x: 2, y: 0.02, w: 2, h: 0.5 }), 1, SPAN_1)],
      { x: 2.5, y: 0.1 },
    );

    const position = resolveSourceSelectionPromptPosition({
      targets: target ? [target] : [],
      renderScale: 1,
      slideSize: { width: 10, height: 5.625 },
      slideViewportRect: { left: 100, top: 80 },
      viewportSize: { width: 1000, height: 720 },
    });

    expect(position).toMatchObject({
      placement: 'below',
    });
    expect(position?.leftPx).toBe(388);
    expect(position?.topPx).toBeCloseTo(80 + 0.52 * 96 + 12);
  });
});

describe('sourceSelection state functions', () => {
  it('replaces selection on normal click and toggles on additive click', () => {
    expect(resolveSourceElementClickSelection({
      currentElementIds: ['a', 'b'],
      clickedElementId: 'c',
      additive: false,
    })).toEqual(['c']);

    expect(resolveSourceElementClickSelection({
      currentElementIds: ['a', 'b'],
      clickedElementId: 'b',
      additive: true,
    })).toEqual(['a']);
  });

  it('deduplicates marquee selection while preserving order', () => {
    expect(resolveSourceMarqueeSelection({
      currentElementIds: ['a', 'b'],
      marqueeElementIds: ['b', 'c', 'c'],
      additive: true,
    })).toEqual(['a', 'b', 'c']);
  });
});
