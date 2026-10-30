import { computed, createApp, h, nextTick, shallowRef } from 'vue';
import VueKonva from 'vue-konva';
import Konva from 'konva';
import KonvaSlideStage from '../../src/renderer/ui/preview/konva/KonvaSlideStage.vue';
import { unpresentedInsertions, type EditingInsertionPreview } from '../../src/renderer/features/editingPreview';
import type { SlideImageResourceMap } from '../../src/renderer/features/renderImageResources';
import type { SlideRenderModel } from '../../src/renderer/types/render';

/** 生产 Vue/Konva 验证：确认前显示真实形状/图片，确认后只绘制一次，取消立即撤下。 */
export async function verifyInsertionPreviewFrames() {
  const source = document.createElement('canvas');
  source.width = 16; source.height = 16;
  const context = source.getContext('2d');
  if (!context) throw new Error('Image fixture canvas unavailable');
  context.fillStyle = '#119933'; context.fillRect(0, 0, 16, 16);
  const imageSource = source.toDataURL();
  const entries = shallowRef<readonly EditingInsertionPreview[]>([]);
  const slide = shallowRef<SlideRenderModel>({ slideId: 'page', index: 0, layoutKey: 'freeform',
    background: { paint: { type: 'none' } }, elements: [] });
  const pending = computed(() => unpresentedInsertions(entries.value, slide.value));
  const imageResources = shallowRef<SlideImageResourceMap>(new Map());
  const host = document.createElement('div'); document.body.append(host);
  const before = new Set(Konva.stages);
  const app = createApp({ setup: () => () => h(KonvaSlideStage, {
    slideRender: slide.value, pendingInsertions: pending.value,
    imageResources: imageResources.value, chartResources: new Map(),
    slideSize: { width: 5, height: 3, unit: 'in' }, rasterScale: 1,
    selectedTargets: [], hoveredTarget: null, marqueeRect: null,
  }) });
  app.use(VueKonva); app.mount(host);
  const stage = Konva.stages.find(candidate => !before.has(candidate));
  if (!stage) throw new Error('Insertion stage not mounted');
  function pixel(x: number, y: number) {
    if (!stage) throw new Error('Insertion stage unavailable');
    stage.draw();
    const rendered = stage.toCanvas().getContext('2d');
    if (!rendered) throw new Error('Rendered canvas unavailable');
    return Array.from(rendered.getImageData(x, y, 1, 1).data);
  }
  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 120; i += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (check()) return;
    }
    throw new Error('Pending content did not become visible');
  }
  try {
    await nextTick();
    const emptyShapePixel = pixel(144, 144).join(',');
    const emptyImagePixel = pixel(336, 144).join(',');
    const startedAt = performance.now();
    entries.value = [
      { object: { kind: 'shape', editKey: 'shape', geometry: 'rect', fill: '#224466', content: '', box: { x: 1, y: 1, w: 1, h: 1 } } },
      { object: { kind: 'image', editKey: 'image', assetId: 'owned-image', fit: 'contain', alt: 'Fixture', box: { x: 3, y: 1, w: 1, h: 1 } }, imageSource },
    ];
    await waitFor(() => pixel(144, 144).join(',') === '34,68,102,255' && pixel(336, 144).join(',') === '17,153,51,255');
    const insertionPreviewMs = performance.now() - startedAt;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const loaded = new Image(); loaded.onload = () => resolve(loaded); loaded.onerror = reject; loaded.src = imageSource;
    });
    imageResources.value = new Map([['confirmed-image', { image, naturalWidth: 16, naturalHeight: 16 }]]);
    slide.value = { ...slide.value, elements: [
      { id: 'confirmed-shape', kind: 'shape', zIndex: 0, box: { x: 1, y: 1, w: 1, h: 1, unit: 'in' },
        geometry: { type: 'preset', name: 'rect' }, fill: { type: 'solid', color: '#224466' },
        authoringRef: { slideKey: 'page', editKey: 'shape', targetKind: 'shape' } },
      { id: 'confirmed-image', kind: 'image', zIndex: 1, box: { x: 3, y: 1, w: 1, h: 1, unit: 'in' },
        assetRef: { type: 'data', dataUri: imageSource }, fitMode: 'contain',
        authoringRef: { slideKey: 'page', editKey: 'image', targetKind: 'image' } },
    ] };
    await nextTick();
    if (pending.value.length || stage.find('Image').length !== 1
      || pixel(144, 144).join(',') !== '34,68,102,255' || pixel(336, 144).join(',') !== '17,153,51,255') {
      throw new Error('Confirmed frame did not take over pending content exactly once');
    }
    entries.value = [];
    slide.value = { ...slide.value, elements: [] };
    await nextTick();
    if (pixel(144, 144).join(',') !== emptyShapePixel || pixel(336, 144).join(',') !== emptyImagePixel) throw new Error('Cancelled insertion remained visible');
    return { insertionPreviewFrames: 3, insertionPreviewMs };
  } finally { app.unmount(); host.remove(); }
}
