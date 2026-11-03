import { CanvasCardSchema, CanvasEdgeSchema, type CanvasCard, type CanvasElement } from '../../src/shared';
import { createPixiCanvasKernel } from '../../src/renderer/kernel';
import { createHtmlCardRasterizer, createLatestRasterQueue } from '../../src/renderer/capabilities/textRasterization';

function dataset(count: number): CanvasElement[] {
  const source = { kind: 'agent', conversationId: 'probe', runId: 'probe' };
  const base = { schemaVersion: 1, revision: 1, locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 };
  const cards: CanvasCard[] = Array.from({ length: count }, (_, i) => CanvasCardSchema.parse({
    ...base, id: `c${i + 1}`, type: 'text', order: String(i).padStart(6, '0'),
    x: (i % 50) * 320, y: Math.floor(i / 50) * 210, width: 280, height: 180, parentId: null,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `中文内容 ${i + 1} / Markdown card` }] }] } },
  }));
  const edges = Array.from({ length: Math.ceil(count * (count === 12000 ? 1.25 : 1.2)) }, (_, i) => CanvasEdgeSchema.parse({
    ...base, id: `e${i + 1}`, type: 'edge', order: String(i).padStart(6, '0'),
    from: { kind: 'card', cardId: cards[i % count].id, side: 'auto' }, to: { kind: 'card', cardId: cards[(i % count + 1 + Math.floor(i / count)) % count].id, side: 'auto' },
    direction: 'forward', lineStyle: 'curve', label: '',
  }));
  return [...cards, ...edges];
}
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

export async function probeKernel(source: HTMLElement) {
  const host = document.createElement('div');
  host.style.cssText = 'width:1600px;height:900px;position:fixed;left:0;top:0;z-index:1';
  const staging = document.createElement('div');
  document.body.append(host, staging);
  const rasterizer = createHtmlCardRasterizer({ host: staging });
  const measured = await rasterizer.measure(source, 280);
  const raster = await rasterizer.rasterize({ element: source, width: 280, height: 180, scale: 2 });
  const check = document.createElement('canvas');
  check.width = raster.bitmap.width; check.height = raster.bitmap.height;
  const context = check.getContext('2d');
  if (!context) throw new Error('probe_canvas_missing');
  context.drawImage(raster.bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, check.width, check.height).data;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0 && pixels[i] < 150) ink++;
  if (!ink) throw new Error('production_rasterizer_empty_bitmap');
  const kernel = await createPixiCanvasKernel({ host, width: 1600, height: 900, resolution: 1 });
  const results = [];
  for (const count of [250, 2500, 12000]) {
    document.title = `Pixi dataset ${count}`;
    const elements = dataset(count);
    const cards = elements.filter((element): element is CanvasCard => element.type !== 'edge');
    const started = performance.now();
    kernel.setElements(elements); kernel.fit(cards);
    await nextFrame();
    const firstFrameMs = performance.now() - started;
    kernel.setSelection(cards.slice(0, 200).map((card) => card.id));
    const initial = kernel.readCamera();
    const gaps: number[] = [];
    let last = await nextFrame();
    for (let i = 0; i < 30; i++) {
      kernel.setCamera({ ...initial, x: initial.x + i * 4, y: initial.y + i * 2 });
      const frame = await nextFrame(); gaps.push(frame - last); last = frame;
    }
    const hit = kernel.hitTest({ x: cards[0].x + 1, y: cards[0].y + 1 });
    if (hit?.id !== cards[0].id) throw new Error('hit_test_disagrees_with_scene');
    const sorted = gaps.sort((a, b) => a - b);
    results.push({ count, firstFrameMs, frameP95: sorted[Math.floor(sorted.length * 0.95)], worstFrame: sorted[sorted.length - 1], ...kernel.readStats() });
  }
  const first = kernel.visibleCards()[0];
  if (!first) throw new Error('visible_cards_empty');
  kernel.setBitmap(first.id, first.revision, 'probe', raster.bitmap);
  const before = kernel.readStats().bitmaps;
  kernel.setAppearance({ dark: false, material: 'card', overview: 'titles' });
  if (kernel.readStats().bitmaps !== before) throw new Error('material_switch_rerasterizes_text');
  kernel.setAppearance({ dark: true, material: 'card', overview: 'titles' });
  if (kernel.readStats().bitmaps !== 0) throw new Error('theme_did_not_invalidate_text');
  const queue = createLatestRasterQueue({ execute: async (value: number) => { await nextFrame(); return value; }, disposeResult: () => undefined, capacity: 4 });
  const queued = Array.from({ length: 100 }, (_, i) => queue.enqueue('one-card', i));
  const completed = await Promise.all(queued);
  if (completed.filter((result) => result.status === 'ready').length !== 1) throw new Error('queue_accepted_stale_raster');
  const queueStats = queue.readStats();
  queue.dispose(); kernel.destroy(); rasterizer.dispose(); host.remove(); staging.remove();
  return { productionRasterInk: ink, measured, rasterSize: [check.width, check.height], queue: queueStats, datasets: results };
}
