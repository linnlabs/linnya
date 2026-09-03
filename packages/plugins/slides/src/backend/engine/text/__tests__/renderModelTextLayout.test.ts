import { describe, expect, it } from 'vitest';
import type {
  PresentationRenderModel,
  TableRenderNode,
  TextRenderNode,
} from '@plugin/slides/shared';
import {
  applyTextLayoutToRenderModel,
  collectClusterAdvanceRequestsForRenderModel,
  createFakeRunAdvanceProviderForTests,
  createTextMeasureRunAdvanceProviderForSourceKind,
} from '../renderModelTextLayout';

function makeTextNode(overrides: Partial<TextRenderNode> = {}): TextRenderNode {
  return {
    id: 'text-1',
    kind: 'text',
    box: { x: 1, y: 1, w: 0.6, h: 1, unit: 'in' },
    zIndex: 0,
    paragraphs: [{
      runs: [
        { text: 'aaa ', fontSize: 12, color: '#111111' },
        { text: 'bbb', fontSize: 12, color: '#222222' },
      ],
    }],
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    wrap: 'word',
    ...overrides,
  };
}

function makeRenderModel(textNode: TextRenderNode): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [{
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { color: '#FFFFFF' },
      elements: [
        textNode,
        {
          id: 'shape-1',
          kind: 'shape',
          box: { x: 2, y: 2, w: 1, h: 1, unit: 'in' },
          zIndex: 1,
          geometry: { type: 'preset', name: 'rect' },
          innerText: makeTextNode({
            id: 'shape-1-inner',
            box: { x: 2, y: 2, w: 1, h: 1, unit: 'in' },
            paragraphs: [{ runs: [{ text: 'inner', fontSize: 10 }] }],
          }),
        },
      ],
    }],
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}

describe('renderModelTextLayout', () => {
  it('populates line-level layout and preserves run slices', () => {
    const textNode = makeTextNode();
    const model = makeRenderModel(textNode);

    applyTextLayoutToRenderModel(model, createFakeRunAdvanceProviderForTests(0.1));

    expect(textNode.layout?.advanceSource).toBe('heuristic');
    expect(textNode.layout?.lines.length).toBeGreaterThan(1);
    const restoredText = textNode.layout?.lines
      .flatMap((line) => line.slices)
      .filter((slice) => slice.isBulletMarker !== true)
      .map((slice) => slice.text)
      .join('');
    expect(restoredText).toBe('aaa bbb');
    expect(textNode.layout?.lines[0]?.slices[0]).toEqual(
      expect.objectContaining({ runIndex: 0, text: 'aaa ' }),
    );
    expect(textNode.layout?.lines[1]?.slices[0]).toEqual(
      expect.objectContaining({ runIndex: 1, text: 'bbb' }),
    );
  });

  it('keeps the vertical center of a middle-aligned resize-shape textbox', () => {
    const textNode = makeTextNode({
      box: { x: 1, y: 2, w: 0.3, h: 0.1, unit: 'in' },
      autoFitPolicy: 'resize-shape',
      verticalAlign: 'middle',
    });
    const originalCenterY = textNode.box.y + textNode.box.h / 2;

    applyTextLayoutToRenderModel(
      makeRenderModel(textNode),
      createFakeRunAdvanceProviderForTests(0.1),
    );

    expect(textNode.box.h).toBeGreaterThan(0.1);
    expect(
      Math.abs(textNode.box.y + textNode.box.h / 2 - originalCenterY),
    ).toBeLessThanOrEqual(0.000001);
  });

  it('also lays out shape inner text', () => {
    const model = makeRenderModel(makeTextNode());

    applyTextLayoutToRenderModel(model, createFakeRunAdvanceProviderForTests(0.1));

    const shape = model.slides[0]?.elements[1];
    expect(shape?.kind).toBe('shape');
    if (shape?.kind === 'shape') {
      expect(shape.innerText?.layout?.lines.map((line) =>
        line.slices.map((slice) => slice.text).join(''),
      )).toEqual(['inner']);
    }
  });

  it('collects per-run cluster advance prewarm requests', () => {
    const model = makeRenderModel(makeTextNode());

    const requests = collectClusterAdvanceRequestsForRenderModel(model);

    expect(requests.map((request) => request.clusters.join(''))).toEqual([
      'aaa ',
      'bbb',
      'inner',
    ]);
    expect(requests[0]?.sourceKind).toBe('generated');
  });

  it('prewarms every shrink-text font scale candidate', () => {
    const model = makeRenderModel(makeTextNode({
      autoFitPolicy: 'shrink-text',
      paragraphs: [{
        runs: [{ text: 'shrink', fontSize: 20 }],
      }],
    }));

    const requests = collectClusterAdvanceRequestsForRenderModel(model);
    const shrinkRequests = requests.filter((request) => request.clusters.join('') === 'shrink');

    expect(shrinkRequests.map((request) => request.style.fontSizePt)).toEqual([
      20,
      19,
      18,
      17,
      16,
      15,
      14,
      13,
      12,
      11,
      10,
      9,
      8,
      7,
      6,
      5,
    ]);
  });

  it('preserves the service-reported advance source in backend text layout', () => {
    const textNode = makeTextNode();
    const model = makeRenderModel(textNode);
    const provider = createTextMeasureRunAdvanceProviderForSourceKind('generated', {
      measureClusterAdvancesWithSource: (request) => ({
        advances: request.clusters.map(() => 0.1),
        source: 'heuristic',
      }),
    });

    applyTextLayoutToRenderModel(model, provider);

    expect(textNode.layout?.advanceSource).toBe('heuristic');
  });

  it('propagates harfbuzz advance source and keeps layout deterministic', () => {
    const textNode = makeTextNode();
    const firstModel = makeRenderModel(textNode);
    const provider = createTextMeasureRunAdvanceProviderForSourceKind('generated', {
      measureClusterAdvancesWithSource: (request) => ({
        advances: request.clusters.map((cluster) => Number((cluster.length * 0.1).toFixed(6))),
        source: 'harfbuzz',
      }),
    });

    applyTextLayoutToRenderModel(firstModel, provider);
    const firstLayout = JSON.stringify(textNode.layout?.lines);

    const secondTextNode = makeTextNode();
    applyTextLayoutToRenderModel(makeRenderModel(secondTextNode), provider);

    expect(textNode.layout?.advanceSource).toBe('harfbuzz');
    expect(JSON.stringify(secondTextNode.layout?.lines)).toBe(firstLayout);
  });

  it('finalizes table-cell text in the backend and prewarms its scale candidates', () => {
    const model = makeRenderModel(makeTextNode());
    const table: TableRenderNode = {
      id: 'table-1',
      kind: 'table',
      box: { x: 3, y: 1, w: 1, h: 0.4, unit: 'in' },
      zIndex: 3,
      columns: [1],
      rows: [0.4],
      cells: [{
        row: 0,
        col: 0,
        paragraphs: [{ runs: [{ text: 'table cell', fontSize: 12 }] }],
      }],
    };
    model.slides[0]?.elements.push(table);

    const requests = collectClusterAdvanceRequestsForRenderModel(model)
      .filter((request) => request.clusters.join('') === 'table cell');
    applyTextLayoutToRenderModel(model, createFakeRunAdvanceProviderForTests(0.08));

    expect(requests).toHaveLength(16);
    expect(table.cells[0]?.textLayout?.lines.length).toBeGreaterThan(0);
    expect(table.cells[0]?.textLayout?.appliedFontScale).toBeLessThanOrEqual(1);
  });
});
