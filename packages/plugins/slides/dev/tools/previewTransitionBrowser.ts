import { normalizePaint } from '../../src/shared/visual/paint';
import { createApp, h, nextTick, shallowRef } from 'vue';
import VueKonva, { Stage as VueStage, Layer as VueLayer } from 'vue-konva';
import Konva from 'konva';
import SlideBackgroundLayer from '../../src/renderer/ui/preview/konva/layers/SlideBackgroundLayer.vue';
import KonvaShapeNode from '../../src/renderer/ui/preview/konva/nodes/KonvaShapeNode.vue';
import type { RenderFill, ShapeRenderNode } from '../../src/renderer/types/render';

const size = { width: 320, height: 180 };
const transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
// 抽取触发缺陷的背景类型序列，不依赖开发数据库或真实文稿内容。
const solid: RenderFill = { type: 'solid', color: '#08140F' };
const gradient: RenderFill = { type: 'linear', angle: 160, stops: [
  { position: 0, color: '#08140F' }, { position: 1, color: '#1B3A2D' },
] };
const radial: RenderFill = { type: 'radial', stops: [
  { position: 0, color: '#08140F' }, { position: 1, color: '#1B3A2D' },
] };
const sequence: RenderFill[] = [solid, gradient, solid, radial, solid, { type: 'none' }, solid, gradient];

declare global {
  interface Window {
    previewTransitionSmoke: Promise<{ frames: number }>;
    verifyPreviewPaintSequence(input: unknown): Promise<{ frames: number }>;
  }
}

function mountPreview(mode: 'background' | 'shape', initial: RenderFill) {
  const fill = shallowRef(initial);
  const host = document.createElement('div');
  document.body.append(host);
  const before = new Set(Konva.stages);
  const app = createApp({
    setup: () => () => h(VueStage, { config: size }, () => mode === 'background'
      ? h(SlideBackgroundLayer, { background: { paint: fill.value }, imageResource: null, logicalSize: size, transform })
      : h(VueLayer, {}, () => h(KonvaShapeNode, { node: shape(fill.value) }))),
  });
  app.use(VueKonva);
  app.mount(host);
  const stage = Konva.stages.find(candidate => !before.has(candidate));
  if (!stage) throw new Error('Preview stage was not mounted');
  return { fill, stage, dispose: () => { app.unmount(); host.remove(); } };
}

function shape(fill: RenderFill): ShapeRenderNode {
  return {
    id: 'stable-shape', kind: 'shape', zIndex: 0,
    box: { x: 0, y: 0, w: size.width / 96, h: size.height / 96, unit: 'in' },
    geometry: { type: 'preset', name: 'rect' }, fill,
  };
}

function pixels(stage: Konva.Stage): Uint8ClampedArray {
  stage.draw();
  const context = stage.toCanvas().getContext('2d');
  if (!context) throw new Error('Preview canvas context unavailable');
  return context.getImageData(0, 0, size.width, size.height).data;
}

async function run(paints: readonly RenderFill[]): Promise<{ frames: number }> {
  let frames = 0;
  for (const mode of ['background', 'shape'] as const) {
    const reused = mountPreview(mode, paints[0]);
    try {
      for (const [index, paint] of paints.entries()) {
        reused.fill.value = paint;
        const fresh = mountPreview(mode, paint);
        try {
          await nextTick();
          const actual = pixels(reused.stage);
          const expected = pixels(fresh.stage);
          const mismatch = actual.findIndex((value, offset) => value !== expected[offset]);
          if (mismatch >= 0) {
            const node = reused.stage.findOne('Rect');
            throw new Error(`${mode} transition ${index + 1} (${paint.type}) differs from fresh render: byte=${mismatch}, actual=${actual[mismatch]}, expected=${expected[mismatch]}, fill=${node?.getAttr('fill')}`);
          }
          frames += 1;
        } finally { fresh.dispose(); }
      }
    } finally { reused.dispose(); }
  }
  return { frames };
}

window.verifyPreviewPaintSequence = (input: unknown) => {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Expected a nonempty paint sequence');
  const paints = input.map((paint: unknown, index: number) => {
    const admitted = normalizePaint(paint, `paints[${index}]`);
    if ('error' in admitted) throw new Error(admitted.error);
    return admitted.value;
  });
  return run(paints);
};
window.previewTransitionSmoke = run(sequence);
