import { beforeAll, afterEach, expect, it } from 'vitest';
import type { Yoga } from 'yoga-layout/load';
import { defaultTextMeasureService, projectFontUnitAdvances } from '@linnya/text-measurement-core';
import type { FlexComposeInput, SlidesManualTargetEdit, RunAdvanceProvider, FontMetricsProvider, RenderNode } from '@plugin/slides/shared';
import { compileFlexInput, initYoga, readYogaRuntimeLoader } from '../../../codegen/compose/flex-layout';
import { buildDeckSpecFromDirectInput } from '../../../codegen/compose/presentationComposeInput';
import { RenderModelMapper } from '../../parser/RenderModelMapper';
import { applyTextLayoutToRenderModel } from '../renderModelTextLayout';
import { isSlideRenderModel } from '@plugin/slides/shared/renderModel';
import { splitSlideContent, restoreSlideContent, viewRecord } from '@plugin/slides/shared/presentationViewSnapshot';
import { projectEditingPreviewSlide, type EditingVisualPreview } from '../../../../renderer/features/editingPreview';

let yoga: Yoga;
beforeAll(async () => { await initYoga(); yoga = await readYogaRuntimeLoader().loadYoga(); });
afterEach(() => defaultTextMeasureService.resetAdapters());
const advances: RunAdvanceProvider = { getClusterAdvances(clusters, style) {
  const fontUnits = { unitsPerEm: 1000, advances: clusters.map((_, index) => index % 3 === 0 ? 721 : 439) };
  return { source: 'harfbuzz', fontUnits, advances: projectFontUnitAdvances(fontUnits, style.fontSizePt, style.letterSpacingPt) };
} };
const metrics: FontMetricsProvider = { getMetrics: style => ({ ascent: style.fontSizePt / 90, descent: style.fontSizePt / 360, lineGap: 0 }),
  getMetricsInEm: () => ({ ascent: 0.8, descent: 0.2, lineGap: 0 }) };

function render(targets: SlidesManualTargetEdit[], centered = false) {
  defaultTextMeasureService.resetAdapters();
  const source: FlexComposeInput = { title: 'Flow editing', layout: { width: 10, height: 5.625, unit: 'in' },
    manualEdits: { version: 2, slides: [{ slideKey: 'page', targets, paintOrder: ['row', 'subtitle', 'title'] }] },
    slides: [{ _type: 'Slide', slideKey: 'page', children: [{ _type: 'View', width: 10, height: 5.625,
      flexDirection: 'column', padding: 0.6, gap: 0.12, alignItems: centered ? 'center' : 'stretch', children: [
        { _type: 'Text', editKey: 'title', width: 6.2, fontSize: 28, content: 'A heading that must wrap and move the surrounding layout', verticalAlign: 'middle' },
        { _type: 'Text', editKey: 'subtitle', content: [{ text: 'Mixed ' }, { text: '中文 and rich subtitle', style: { fontSize: 20 } }], fontSize: 16, width: 6.4, marginBottom: 0.2 },
        { _type: 'View', editKey: 'row', flexDirection: 'row', gap: 0.3, width: 8.8, height: 2.2, children: [
          { _type: 'View', editKey: 'card', flexDirection: 'column', gap: 0.12, flex: 1, padding: 0.3, backgroundColor: '#DDEEFF', children: [
            { _type: 'Shape', editKey: 'badge', width: 1, height: 0.5, fill: '#224466', content: 'Badge' },
            { _type: 'Text', editKey: 'body', content: 'Nested flexible text with automatic height and inherited width.', fontSize: 12, lineHeight: 1.3 },
          ] },
          { _type: 'View', editKey: 'other-card', flex: 1, padding: 0.2, backgroundColor: '#EEDDCC', children: [
            { _type: 'Text', content: 'A sibling card must preserve its own layout.', fontSize: 12 },
            { _type: 'Text', content: 'Fixed height without explicit width', height: 0.4, fontSize: 10 },
          ] },
        ] },
      ] }] }] };
  const compiled = compileFlexInput(source);
  if (!compiled.input) throw new Error(compiled.error);
  const deck = buildDeckSpecFromDirectInput(compiled.input);
  const model = new RenderModelMapper().fromGeneratedDeck('flow', 1, 'Flow editing', deck, { width: 10, height: 5.625 });
  applyTextLayoutToRenderModel(model, advances, metrics);
  const wire: unknown = JSON.parse(JSON.stringify(model.slides[0]));
  if (!isSlideRenderModel(wire)) throw new Error('Layout replay failed strict wire admission');
  // 生产界面经过内容/定位分块，而非直接接收 RenderModel；新增编辑事实也必须无损到达。
  const parts = splitSlideContent(wire);
  const result = restoreSlideContent(viewRecord(JSON.parse(JSON.stringify(parts.content))), viewRecord(JSON.parse(JSON.stringify(parts.binding))), wire.slideId, wire.index);
  expect(result).toEqual(wire);
  return result;
}

it.each([false, true])('flow width preview matches full compilation, including nested siblings and paint ordering: centered=%s', centered => {
  const initialEdits: SlidesManualTargetEdit[] = [{ kind: 'text', editKey: 'title', translation: { dx: 0.1042, dy: 0.0521 } }];
  const initial = render(initialEdits, centered);
  const original = structuredClone(initial);
  const pending: EditingVisualPreview[] = [];
  let shift = 0.1042;
  let targets = [...initialEdits];
  for (const [editKey, width, dx] of [['title', 2.3456, 0], ['title', 5.1234, -2.7778], ['body', 1.75, 0], ['title', 7.5, 0]] as const) {
    const node = initial.elements.find(item => item.authoringRef?.editKey === editKey);
    if (!node) throw new Error('Missing flow target');
    if (editKey === 'title') shift += dx;
    pending.push({ elementId: node.id, affectedElementIds: [node.id],
      operation: { op: 'set_text_width', target: { slideKey: 'page', editKey }, targetKind: 'text', width },
      ...(dx ? { translationDelta: { dx, dy: 0 } } : {}) });
    targets = [...targets.filter(target => target.editKey !== editKey), { kind: 'text', editKey, width,
      ...(editKey === 'title' ? { translation: { dx: shift, dy: 0.0521 } } : {}) }];
    const preview = projectEditingPreviewSlide(initial, pending, yoga);
    const final = render(targets, centered);
    for (const confirmed of final.elements) compare(preview.get(confirmed.id), confirmed);
  }
  expect(initial).toEqual(original);
  expect([...projectEditingPreviewSlide(initial, [], yoga).values()]).toEqual(initial.elements);
});

it('inserting or copying a page changes replay identities without resending layout content', () => {
  const initial = render([]);
  const replay = initial.layoutReplay;
  if (!replay) throw new Error('Missing flow replay');
  const copied = { ...initial, slideId: 's2', index: 1,
    layoutReplay: { nodes: replay.nodes.map(node => ({ ...node, id: node.id.replace('layout:s1:', 'layout:s2:') })) } };
  const before = splitSlideContent(initial), after = splitSlideContent(copied);
  expect(after.content).toEqual(before.content);
  expect(after.binding).not.toEqual(before.binding);
  expect(restoreSlideContent(before.content, after.binding, copied.slideId, copied.index)).toEqual(copied);
});

function compare(actual: RenderNode | undefined, expected: RenderNode): void {
  if (!actual) throw new Error(`Missing preview node: ${expected.id}`);
  for (const axis of ['x', 'y', 'w', 'h'] as const) {
    // 旧正式位置已量化，布局差值的最后一次量化最多相差一个编译格点（0.0096 px）。
    expect(Math.abs(actual.box[axis] - expected.box[axis]), `${expected.authoringRef?.editKey ?? expected.id}.${axis}: ${JSON.stringify({ actual: actual.box, expected: expected.box })}`).toBeLessThanOrEqual(0.000101);
  }
  if (actual.kind === 'text' && expected.kind === 'text') expect(actual.layout, expected.id).toEqual(expected.layout);
  if (actual.kind === 'shape' && expected.kind === 'shape' && actual.innerText && expected.innerText) compare(actual.innerText, expected.innerText);
}
