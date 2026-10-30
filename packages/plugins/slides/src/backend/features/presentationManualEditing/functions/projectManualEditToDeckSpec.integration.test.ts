import { afterEach, expect, it } from 'vitest';
import { defaultTextMeasureService } from '@linnya/text-measurement-core';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { RenderModelMapper } from '../../../engine/parser/RenderModelMapper';
import { applyTextLayoutToRenderModel } from '../../../engine/text/renderModelTextLayout';
import { projectEditingPreviewNode } from '../../../../renderer/features/editingPreview';
import { isSlideRenderModel } from '@plugin/slides/shared/renderModel';
import type { DeckSpec, SlidesManualEditOperation } from '@plugin/slides/shared';
import { CodegenDeckBuilder } from '../../../codegen/CodegenDeckBuilder';
import { pptComposeProfile } from '../../../sandbox/pptComposeProfile';
import { createInProcessPresentationBuildExecution } from '../../presentationBuildExecution';
import { projectManualEditToDeckSpec } from './projectManualEditToDeckSpec';
import { writeManualEditsToDeckSource } from './writeManualEditsToDeckSource';

afterEach(() => defaultTextMeasureService.resetAdapters());

it.each([false, true])('连续编辑等于完整编译：structured=%s，包含文字、旋转和后代布局证据', async (structured) => {
  // 与生产 Worker 一样使用 portable Yoga 测量，不依赖宿主在其他测试中的 adapter 装配。
  defaultTextMeasureService.resetAdapters();
  const profiles = new SandboxProfileRegistry(); profiles.register(pptComposeProfile);
  const unused = async (): Promise<never> => { throw new Error('Projection comparison must not persist or export'); };
  const builder = new CodegenDeckBuilder({ presentationRepo: { getPresentation: async () => null, createPresentation: unused, commitPresentation: unused },
    engine: { assembleDeck: unused }, sandbox: new SandboxService(profiles, createSandboxEvaluatorTestRunner()),
    buildExecution: createInProcessPresentationBuildExecution() });
  let source = `const slide = createSlide({ slideKey: 'page' });
const outer = createFrame({ editKey: 'outer', width: 5.12345, height: 4, backgroundColor: '#123456' });
outer.x = 0.123456; outer.y = 0.234567;
const inner = createFrame({ editKey: 'inner', width: 4, height: 3, backgroundColor: '#223344' });
const shape = createShape({ editKey: 'shape', geometry: 'rect', fill: '#112233', content: 'Shape text wraps after resizing', width: 2.12345, height: 1.12345 });
shape.rotate = 25;
inner.add(shape);
const fixedText = createText({ editKey: 'fixed-text', content: 'Continuous width changes should wrap without waiting', fontSize: 18, x: 0.25, y: 0.25, width: 2, height: 0.5 });
inner.add(fixedText);
inner.add(createText({ editKey: 'flow-text', content: 'Auto height text inside the moved frame', width: 3 }));
outer.add(inner); slide.add(outer);
const image = createImage({ editKey: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', width: 2, height: 2 });
image.x = 7; image.y = 1; slide.add(image);
const autoText = createText({ editKey: 'auto-text', content: [{ text: 'Automatic ' }, { text: 'height with several lines and Chinese 中文换行', style: { fontSize: 26 } }], fontSize: 18, x: 1, y: 5, width: 4, minHeight: 0.35, lineHeight: 1.2, verticalAlign: 'middle', letterSpacing: 0.15 });
slide.add(autoText);
slide.add(createText({ editKey: 'clamped-text', content: 'Height constraints with fractional compiler grid dimensions', fontSize: 18, x: 7, y: 5, width: 3, minHeight: 0.35005, maxHeight: 0.98765 }));
${structured ? "slide.add(createTable({ headers: ['Measure'], rows: [['Value']], width: 2, height: 1 }));" : ''}
compose({ title: 'Projection equivalence', slides: [slide] });`;
  let deck = await builder.buildDeckSpecFromSource({ nodeId: 'deck', source });
  expect(projectManualEditToDeckSpec(deck, { op: 'set_text_width', targetKind: 'text', target: { slideKey: 'page', editKey: 'flow-text' }, width: 2 })).toEqual({ kind: 'requires_full_compile' });
  expect(projectManualEditToDeckSpec(deck, { op: 'set_visual_size', targetKind: 'shape', target: { slideKey: 'page', editKey: 'shape' }, visualSize: { width: 3, height: 2 }, translationDelta: { dx: 1 / 96, dy: 0 } })).toEqual({ kind: 'requires_full_compile' });
  const initialSource = source;
  const operations: SlidesManualEditOperation[] = [
    { op: 'set_text_width', targetKind: 'text', target: { slideKey: 'page', editKey: 'clamped-text' }, width: 0.5 },
    { op: 'set_text_width', targetKind: 'text', target: { slideKey: 'page', editKey: 'clamped-text' }, width: 8 },
    { op: 'set_text_width', targetKind: 'text', target: { slideKey: 'page', editKey: 'auto-text' }, width: 1.2345 },
    { op: 'set_text_width', targetKind: 'text', target: { slideKey: 'page', editKey: 'auto-text' }, width: 5.25 },
    { op: 'set_text_width', targetKind: 'text', target: { slideKey: 'page', editKey: 'fixed-text' }, width: 1.2345 },
    { op: 'translate_by', targetKind: 'text', target: { slideKey: 'page', editKey: 'fixed-text' }, delta: { dx: -0.25, dy: 0 } },
    { op: 'set_text_width', targetKind: 'text', target: { slideKey: 'page', editKey: 'fixed-text' }, width: 3.25 },
    { op: 'set_visual_size', targetKind: 'shape', target: { slideKey: 'page', editKey: 'shape' }, visualSize: { width: 3.7654321, height: 2.456789 }, translationDelta: { dx: -0.1234, dy: 0.5678 } },
    { op: 'set_visual_size', targetKind: 'shape', target: { slideKey: 'page', editKey: 'shape' }, visualSize: { width: 0.7654321, height: 0.456789 } },
    { op: 'set_fill_color', targetKind: 'shape', target: { slideKey: 'page', editKey: 'shape' }, color: '#aAbBcC' },
    { op: 'set_visual_size', targetKind: 'image', target: { slideKey: 'page', editKey: 'image' }, visualSize: { width: 3.333333, height: 3.333333 }, translationDelta: { dx: -0.3333, dy: -0.3333 } },
    { op: 'translate_by', targetKind: 'frame', target: { slideKey: 'page', editKey: 'inner' }, delta: { dx: 0.1042, dy: 0.0521 } },
    { op: 'translate_by', targetKind: 'frame', target: { slideKey: 'page', editKey: 'outer' }, delta: { dx: -0.1042, dy: -0.0521 } },
    { op: 'set_fill_color', targetKind: 'frame', target: { slideKey: 'page', editKey: 'outer' }, color: '#cCbBaA' },
  ];
  for (const operation of operations) {
    source = writeManualEditsToDeckSource(source, operation).source;
    const projected = projectManualEditToDeckSpec(deck, operation);
    if (projected.kind !== 'projected') throw new Error(`Expected projection: ${operation.op}`);
    const compiled = await builder.buildDeckSpecFromSource({ nodeId: 'deck', source });
    expect(projected.deckSpec, operation.op).toEqual(compiled);
    if (operation.op === 'set_text_width') {
      const before = render(deck).elements.find(node => node.authoringRef?.editKey === operation.target.editKey);
      const after = render(compiled).elements.find(node => node.authoringRef?.editKey === operation.target.editKey);
      if (!before || after?.kind !== 'text') throw new Error('Missing rendered text');
      const preview = projectEditingPreviewNode(before, [{ elementId: before.id, affectedElementIds: [before.id], operation }]);
      if (preview.kind !== 'text') throw new Error('Missing width preview');
      expect(preview.box).toEqual(after.box);
      expect(preview.layout).toEqual(after.layout);
    }
    deck = projected.deckSpec;
  }
  const plainFrameSource = initialSource.replace(", backgroundColor: '#123456'", '');
  const plainFrame = await builder.buildDeckSpecFromSource({ nodeId: 'deck', source: plainFrameSource.replace("const outer = createFrame({ editKey: 'outer',", "const outer = createFrame({ editKey: 'plain-frame',") });
  expect(projectManualEditToDeckSpec(plainFrame, { op: 'translate_by', targetKind: 'frame', target: { slideKey: 'page', editKey: 'plain-frame' }, delta: { dx: 1, dy: 0 } })).toEqual({ kind: 'requires_full_compile' });
});

function render(deck: DeckSpec) {
  const model = new RenderModelMapper().fromGeneratedDeck('deck', 1, deck.title, deck, { width: 13.333, height: 7.5 });
  applyTextLayoutToRenderModel(model, { getClusterAdvances: (clusters, style) => ({ source: 'harfbuzz', advances: clusters.map(() => style.fontSizePt / 72 * 0.6) }) }, { getMetrics: () => undefined });
  const wire: unknown = JSON.parse(JSON.stringify(model.slides[0]));
  if (!isSlideRenderModel(wire)) throw new Error('Invalid text measurement transport');
  return wire;
}
