import { computed, createApp, h, nextTick, shallowRef } from 'vue';
import VueKonva from 'vue-konva';
import Konva from 'konva';
import KonvaSlideStage from '../../src/renderer/ui/preview/konva/KonvaSlideStage.vue';
import ElementPropertyToolbar from '../../src/renderer/features/elementProperties/ui/ElementPropertyToolbar.vue';
import { collectManualEditableTargets, projectManualEditableTargetSelection } from '../../src/renderer/features/manualEditing';
import { projectElementPropertyTarget } from '../../src/renderer/features/elementProperties/functions/projectElementPropertyTarget';
import { collectEditingPreviewGeometries, type EditingVisualPreview, type EditingVisualOperation } from '../../src/renderer/features/editingPreview';
import { buildTextLineConfigs } from '../../src/renderer/features/konvaPreview/functions/builders/textBuilder';
import type { SlideRenderModel, TextRenderNode } from '../../src/shared/renderModel';
import { preparePreviewFixture } from './preparedPreviewFixture';

/** 真正 Vue/Konva + 工具栏：持有正式修订，逐帧验证提交前后没有混合字号/坐标。 */
export async function verifyFontPreviewFrames() {
  const source: TextRenderNode = { id: 'font-text', kind: 'text', zIndex: 0,
    box: { x: 1, y: 1, w: 3, h: 0.6, unit: 'in' }, padding: { top: 0.05, right: 0.1, bottom: 0.05, left: 0.1 },
    authoringRef: { slideKey: 's', editKey: 't', targetKind: 'text' },
    authoringEdit: { capabilities: ['translate', 'set_text_content', 'set_text_style'],
      text: { kind: 'rich_text', content: [{ text: 'ABCD ' }, { text: 'EFGH' }], baseStyle: { fontSize: 14 } } },
    paragraphs: [{ align: 'center', runs: [{ text: 'ABCD ', fontSize: 14 }, { text: 'EFGH', fontSize: 14 }] }],
    autoFitPolicy: 'resize-shape', verticalAlign: 'top', wrap: 'word', overflow: 'clip' };
  const committed = shallowRef(preparePreviewFixture(source, 'plain-textbox'));
  const pending = shallowRef<readonly EditingVisualPreview[]>([]);
  const target = computed(() => collectManualEditableTargets([committed.value])[0]!);
  const presented = computed(() => projectManualEditableTargetSelection(target.value, new Map(),
    collectEditingPreviewGeometries([committed.value], pending.value)));
  const slide = computed<SlideRenderModel>(() => ({ slideId: 's', index: 0, layoutKey: 'blank',
    background: { paint: { type: 'solid', color: '#FFFFFF' } }, elements: [committed.value] }));
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:760px;height:760px';
  document.body.append(host);
  const before = new Set(Konva.stages);
  const app = createApp({ render: () => [h(KonvaSlideStage, { slideRender: slide.value, imageResources: new Map(),
    chartResources: new Map(), slideSize: { width: 7, height: 7, unit: 'in' }, rasterScale: 1,
    selectedTargets: [], hoveredTarget: null, marqueeRect: null, manualSelectedTarget: presented.value,
    manualVisualPreviews: pending.value }), h(ElementPropertyToolbar, {
    target: projectElementPropertyTarget(target.value, pending.value), busy: false,
    anchor: { selection: { left: 96, top: 96, width: 288, height: 60 }, viewport: { width: 760, height: 760 } },
    onSubmit(operation: EditingVisualOperation) {
      pending.value = [...pending.value, { elementId: source.id, affectedElementIds: [source.id], operation }];
    },
  })] });
  app.use(VueKonva); app.mount(host);
  const stage = Konva.stages.find(candidate => !before.has(candidate));
  if (!stage) throw new Error('Missing font preview stage');
  const trace: { phase: string; fontSize: number; elapsedMs: number; slices: { x: number; y: number; fontSize: number }[]; box: TextRenderNode['box'] }[] = [];
  const start = performance.now();
  async function capture(phase: string, fontSize: number, expected: TextRenderNode) {
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      stage!.draw();
      const painted = stage!.getLayers()[1]?.find<Konva.Text>('Text') ?? [];
      const slices = painted.map(node => ({ x: node.x(), y: node.y(), fontSize: node.fontSize() }));
      const expectedSlices = buildTextLineConfigs(expected).map(node => ({ x: node.x, y: node.y, fontSize: node.fontSize }));
      if (JSON.stringify(slices) !== JSON.stringify(expectedSlices)) throw new Error(`Mixed font preview frame at ${phase}/${fontSize}`);
      if ((['x', 'y', 'w', 'h'] as const).some(key => Math.abs(presented.value.bounds[key] - expected.box[key]) > 1e-9)) {
        throw new Error(`Selection diverged at ${phase}/${fontSize}: ${JSON.stringify(presented.value.bounds)} vs ${JSON.stringify(expected.box)}`);
      }
      trace.push({ phase, fontSize, elapsedMs: performance.now() - start, slices, box: expected.box });
    }
  }
  try {
    await nextTick();
    for (const fontSize of [48, 8, 96]) {
      const input = host.querySelector<HTMLInputElement>('.slides-element-property-toolbar__font-input');
      if (!input) throw new Error('Missing font size input');
      input.value = String(fontSize);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const expected = preparePreviewFixture({ ...source,
        paragraphs: source.paragraphs.map(p => ({ ...p, runs: p.runs.map(run => 'text' in run ? { ...run, fontSize } : run) })) }, 'plain-textbox');
      await nextTick();
      if (pending.value.length !== 1) throw new Error('Font edit did not produce one intent');
      await capture('preview', fontSize, expected);
      committed.value = expected;
      pending.value = [];
      await nextTick();
      await capture('revision', fontSize, expected);
    }
    return { fontPreviewFrames: trace.length, fontPreviewTrace: trace };
  } finally { app.unmount(); host.remove(); }
}
