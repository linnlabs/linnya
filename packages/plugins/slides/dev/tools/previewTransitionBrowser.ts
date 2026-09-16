import { mountShapeTextEditingSmoke } from './shapeTextEditingBrowser';
import { normalizePaint } from '../../src/shared/visual/paint';
import { mountManualPropertySmoke } from './manualPropertyBrowser';
import { createApp, h, nextTick, shallowRef } from 'vue';
import VueKonva, { Stage as VueStage, Layer as VueLayer } from 'vue-konva';
import Konva from 'konva';
import SlideBackgroundLayer from '../../src/renderer/ui/preview/konva/layers/SlideBackgroundLayer.vue';
import KonvaShapeNode from '../../src/renderer/ui/preview/konva/nodes/KonvaShapeNode.vue';
import KonvaSlideStage from '../../src/renderer/ui/preview/konva/KonvaSlideStage.vue';
import type {
  RenderFill,
  ShapeRenderNode,
  SlideRenderModel,
} from '../../src/renderer/types/render';
import type {
  ManualEditingTranslationPreview,
  ManualEditingVisualPreview,
} from '../../src/renderer/features/manualEditing';

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
    previewTransitionSmoke: Promise<{
      frames: number;
      manualTranslationFrames: number;
      manualVisualFrames: number;
    }>;
    verifyPreviewPaintSequence(input: unknown): Promise<{ frames: number }>;
    mountShapeTextEditingSmoke: typeof mountShapeTextEditingSmoke;
    shapeTextEditingSmoke: ReturnType<typeof mountShapeTextEditingSmoke>;
    mountManualPropertySmoke: typeof mountManualPropertySmoke;
    manualPropertySmoke: ReturnType<typeof mountManualPropertySmoke>;
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

/** 真实挂载 KonvaSlideStage，防止位移预览被误传给无关图层。 */
async function verifyManualTranslation(): Promise<{ manualTranslationFrames: number }> {
  const previewTranslations = shallowRef<ReadonlyMap<string, ManualEditingTranslationPreview>>(
    new Map(),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const before = new Set(Konva.stages);
  const slideRender: SlideRenderModel = {
    slideId: 'manual-translation',
    index: 0,
    layoutKey: 'LAYOUT_WIDE',
    background: { paint: { type: 'none' } },
    elements: [
      shape(solid),
      {
        ...shape({ type: 'solid', color: '#FFFFFF' }),
        id: 'stable-frame-child',
        zIndex: 1,
        box: { x: 1, y: 0.25, w: 0.5, h: 0.5, unit: 'in' },
      },
    ],
  };
  const app = createApp({
    setup: () => () => h(KonvaSlideStage, {
      slideRender,
      imageResources: new Map(),
      chartResources: new Map(),
      slideSize: { width: size.width / 96, height: size.height / 96, unit: 'in' },
      rasterScale: 1,
      selectedTargets: [],
      hoveredTarget: null,
      marqueeRect: null,
      previewTranslations: previewTranslations.value,
    }),
  });
  app.use(VueKonva);
  app.mount(host);
  try {
    const stage = Konva.stages.find(candidate => !before.has(candidate));
    if (!stage) throw new Error('Manual editing stage was not mounted');
    await nextTick();
    assertShapePositions(stage, [[0, 0], [96, 24]]);
    const framePreview: ManualEditingTranslationPreview = {
      elementId: 'stable-shape',
      affectedElementIds: ['stable-shape', 'stable-frame-child'],
      dx: 1,
      dy: 0.5,
    };
    previewTranslations.value = new Map(
      framePreview.affectedElementIds.map(elementId => [elementId, framePreview]),
    );
    await nextTick();
    assertShapePositions(stage, [[96, 48], [192, 72]]);
    return { manualTranslationFrames: 2 };
  } finally {
    app.unmount();
    host.remove();
  }
}

/** 在同一生产 Konva 节点上验证属性乐观值与撤回，防止只测纯函数却漏传组件合同。 */
async function verifyManualVisual(): Promise<{ manualVisualFrames: number }> {
  const manualVisualPreviews = shallowRef<readonly ManualEditingVisualPreview[]>([]);
  const host = document.createElement('div');
  document.body.append(host);
  const before = new Set(Konva.stages);
  const slideRender: SlideRenderModel = {
    slideId: 'manual-visual',
    index: 0,
    layoutKey: 'LAYOUT_WIDE',
    background: { paint: { type: 'none' } },
    elements: [shape(solid)],
  };
  const app = createApp({
    setup: () => () => h(KonvaSlideStage, {
      slideRender,
      imageResources: new Map(),
      chartResources: new Map(),
      slideSize: { width: size.width / 96, height: size.height / 96, unit: 'in' },
      rasterScale: 1,
      selectedTargets: [],
      hoveredTarget: null,
      marqueeRect: null,
      manualVisualPreviews: manualVisualPreviews.value,
    }),
  });
  app.use(VueKonva);
  app.mount(host);
  try {
    const stage = Konva.stages.find(candidate => !before.has(candidate));
    if (!stage) throw new Error('Manual visual stage was not mounted');
    await nextTick();
    assertShapeVisual(stage, { color: '#08140F', width: 320, height: 180, visible: true });

    manualVisualPreviews.value = [{
      elementId: 'stable-shape',
      affectedElementIds: ['stable-shape'],
      operation: {
        op: 'set_fill_color',
        target: { slideKey: 'overview', editKey: 'shape' },
        targetKind: 'shape',
        color: '#DC2626',
      },
    }];
    await nextTick();
    assertShapeVisual(stage, { color: '#DC2626', width: 320, height: 180, visible: true });

    manualVisualPreviews.value = [
      {
        elementId: 'stable-shape',
        affectedElementIds: ['stable-shape'],
        operation: {
          op: 'set_fill_color',
          target: { slideKey: 'overview', editKey: 'shape' },
          targetKind: 'shape',
          color: '#DC2626',
        },
      },
      {
        elementId: 'stable-shape',
        affectedElementIds: ['stable-shape'],
        operation: {
          op: 'set_visual_size',
          target: { slideKey: 'overview', editKey: 'shape' },
          targetKind: 'shape',
          visualSize: { width: 2, height: 1 },
        },
      },
    ];
    await nextTick();
    assertShapeVisual(stage, { color: '#DC2626', width: 192, height: 96, visible: true });

    manualVisualPreviews.value = [{
      elementId: 'stable-shape',
      affectedElementIds: ['stable-shape'],
      operation: {
        op: 'delete_target',
        target: { slideKey: 'overview', editKey: 'frame' },
        targetKind: 'frame',
      },
    }];
    await nextTick();
    assertShapeVisual(stage, { color: '#08140F', width: 320, height: 180, visible: false });

    manualVisualPreviews.value = [];
    await nextTick();
    assertShapeVisual(stage, { color: '#08140F', width: 320, height: 180, visible: true });
    return { manualVisualFrames: 5 };
  } finally {
    app.unmount();
    host.remove();
  }
}

function assertShapeVisual(
  stage: Konva.Stage,
  expected: { readonly color: string; readonly width: number; readonly height: number; readonly visible: boolean },
): void {
  const node = stage.getLayers()[1]?.findOne<Konva.Rect>('Rect');
  if (!node) throw new Error('Manual visual shape was not rendered');
  if (
    node.fill() !== expected.color
    || node.width() !== expected.width
    || node.height() !== expected.height
    || node.isVisible() !== expected.visible
  ) {
    throw new Error(
      `Manual visual differs: actual=(${node.fill()}, ${node.width()}, ${node.height()}, ${node.isVisible()}), expected=(${expected.color}, ${expected.width}, ${expected.height}, ${expected.visible})`,
    );
  }
}

function assertShapePositions(
  stage: Konva.Stage,
  expectedPositions: ReadonlyArray<readonly [number, number]>,
): void {
  const contentLayer = stage.getLayers()[1];
  const nodes = contentLayer?.find('Rect') ?? [];
  if (nodes.length !== expectedPositions.length) {
    throw new Error(`Manual editing rendered ${nodes.length} shapes; expected ${expectedPositions.length}`);
  }
  for (const [index, node] of nodes.entries()) {
    const [expectedX, expectedY] = expectedPositions[index] ?? [];
    const position = node.getAbsolutePosition();
    if (position.x !== expectedX || position.y !== expectedY) {
      throw new Error(
        `Manual translation ${index} differs: actual=(${position.x}, ${position.y}), expected=(${expectedX}, ${expectedY})`,
      );
    }
  }
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
window.previewTransitionSmoke = (async () => ({
  ...await run(sequence),
  ...await verifyManualTranslation(),
  ...await verifyManualVisual(),
}))();
window.mountManualPropertySmoke = mountManualPropertySmoke;

window.mountShapeTextEditingSmoke = mountShapeTextEditingSmoke;
