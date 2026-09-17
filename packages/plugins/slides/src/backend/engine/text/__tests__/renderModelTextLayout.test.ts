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

it('carries exact resize measurements through the codec and matches the committed shape text layout', async () => {
  const { resizeShapeTextPreview } = await import('../../../../renderer/features/manualEditing/functions/resizeShapeTextPreview');
  const { isSlideRenderModel, findSlideRenderModelFailurePath } = await import('../../../../shared/renderModel/renderModelCodec');
  const model = makeRenderModel(makeTextNode());
  model.slides[0].background = { paint: { type: 'solid', color: '#FFFFFF' } };
  const shape = model.slides[0].elements.find(node => node.kind === 'shape');
  if (!shape || shape.kind !== 'shape' || !shape.innerText) throw new Error('Missing shape');
  shape.authoringRef = { slideKey: 'slide', editKey: 'shape', targetKind: 'shape' };
  shape.authoringEdit = { capabilities: ['translate', 'set_fill_color', 'set_visual_size', 'set_text_content', 'delete'],
    text: { kind: 'plain_text', content: 'Shape text' }, fill: { kind: 'non_solid' } };
  shape.innerText.paragraphs = [{ align: 'center', runs: [{ text: 'Repeated AV ffi 文本内容在不同宽度下自动换行', fontSize: 24 }] }];
  shape.innerText.autoFitPolicy = 'shrink-text';
  const provider = { getClusterAdvances: (clusters: readonly string[], style: { fontSizePt: number }) => ({
    advances: clusters.map((_, index) => style.fontSizePt / 72 * (index % 2 ? 0.4 : 0.65)), source: 'harfbuzz' as const,
  }) };
  const metrics = { getMetrics: (style: { fontSizePt: number }) => ({ ascent: style.fontSizePt / 90, descent: style.fontSizePt / 360, lineGap: 0 }) };
  applyTextLayoutToRenderModel(model, provider, metrics);
  const wire: unknown = JSON.parse(JSON.stringify(model.slides[0]));
  expect(isSlideRenderModel(wire), findSlideRenderModelFailurePath(wire)).toBe(true);
  if (!isSlideRenderModel(wire)) throw new Error('Invalid wire model');
  const wireShape = wire.elements.find(node => node.kind === 'shape');
  if (!wireShape || wireShape.kind !== 'shape' || !wireShape.innerText?.preparedResizeLayout) throw new Error('Measurements lost in transport');
  for (const [w, h] of [[0.5, 0.25], [2, 0.7], [4, 2]]) {
    const preview = resizeShapeTextPreview(wireShape.innerText, w - wireShape.innerText.box.w, h - wireShape.innerText.box.h);
    const finalModel = structuredClone(model);
    const finalShape = finalModel.slides[0].elements.find(node => node.kind === 'shape');
    if (!finalShape || finalShape.kind !== 'shape' || !finalShape.innerText) throw new Error('Missing final shape');
    finalShape.innerText.box = { ...finalShape.innerText.box, w, h };
    applyTextLayoutToRenderModel(finalModel, provider, metrics);
    expect(preview.layout).toEqual(finalShape.innerText.layout);
  }
});

it('matches a freshly mapped generated shape across default font and compact padding thresholds', async () => {
  const { buildGeneratedShapeTextNode } = await import('../../parser/render-model/RenderModelText');
  const { resizeShapeTextPreview } = await import('../../../../renderer/features/manualEditing/functions/resizeShapeTextPreview');
  const content = 'AVAV Shape';
  const create = (w: number, h: number) => buildGeneratedShapeTextNode({ id: 'shape-inner', zIndex: 0,
    box: { x: 0, y: 0, w, h, unit: 'in' } }, content, {}, 'Arial', undefined);
  const model = makeRenderModel(makeTextNode());
  const shape = model.slides[0].elements.find(node => node.kind === 'shape');
  if (!shape || shape.kind !== 'shape') throw new Error('Missing shape');
  shape.authoringEdit = { capabilities: ['set_visual_size'] };
  shape.innerText = create(2, 1);
  const provider = { getClusterAdvances: (clusters: readonly string[], style: { fontSizePt: number }) => ({
    advances: clusters.map((_, i) => style.fontSizePt / 72 * (i % 2 ? 0.4 : 0.65)), source: 'harfbuzz' as const,
  }) };
  const metrics = { getMetrics: (style: { fontSizePt: number }) => ({ ascent: style.fontSizePt / 90, descent: style.fontSizePt / 360, lineGap: 0 }) };
  applyTextLayoutToRenderModel(model, provider, metrics);
  const original = structuredClone(shape.innerText);
  for (const [w, h] of [[1, 0.4], [1.5, 0.55], [2, 1.8], [3, 2.5], [0.5, 0.2]]) {
    const preview = resizeShapeTextPreview(original, w - original.box.w, h - original.box.h);
    shape.innerText = create(w, h);
    applyTextLayoutToRenderModel(model, provider, metrics);
    expect(preview.paragraphs).toEqual(shape.innerText.paragraphs);
    expect(preview.padding).toEqual(shape.innerText.padding);
    expect(preview.layout).toEqual(shape.innerText.layout);
  }
});

it('omits editing measurements and extra font variants for read-only rendering', () => {
  const model = makeRenderModel(makeTextNode());
  const shape = model.slides[0].elements.find(node => node.kind === 'shape');
  if (!shape || shape.kind !== 'shape' || !shape.innerText) throw new Error('Missing shape');
  shape.authoringEdit = { capabilities: ['translate', 'set_fill_color', 'set_visual_size'], fill: { kind: 'non_solid' } };
  shape.innerText.shapeTextSizing = { rotated: false };
  const readonlyOptions = { prepareResizeMeasurements: false };
  expect(collectClusterAdvanceRequestsForRenderModel(model, readonlyOptions).length)
    .toBeLessThan(collectClusterAdvanceRequestsForRenderModel(model).length);
  applyTextLayoutToRenderModel(model, createFakeRunAdvanceProviderForTests(0.08), undefined, readonlyOptions);
  expect(shape.innerText.layout?.lines.length).toBeGreaterThan(0);
  expect(shape.innerText.preparedResizeLayout).toBeUndefined();
});
