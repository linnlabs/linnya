import { CanvasCardSchema, CanvasEdgeSchema, type CanvasCard, type CanvasElement } from '../../src/shared';
import { createPixiCanvasKernel, type CanvasKernel } from '../../src/renderer/kernel';
import { createCanvasRasterPresentation } from '../../src/renderer/orchestration/createCanvasRasterPresentation';
import '@linnya/markdown-document-core/style.css';
import '../../src/renderer/features/cardRendering/styles/canvasCardInk.css';
import '../../src/renderer/styles/canvas.css';

function fixture(count: number, clustered: boolean): CanvasElement[] {
  const source = { kind: 'agent', conversationId: 'performance', runId: 'fixed-fixture-v1' };
  const base = { schemaVersion: 1, revision: 1, locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 };
  let seed = 0x183925;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const columns = Math.ceil(Math.sqrt(count * 1.6));
  const cards: CanvasCard[] = Array.from({ length: count }, (_, i) => CanvasCardSchema.parse({ ...base,
    id: `c${i + 1}`, type: 'text', order: String(i).padStart(6, '0'),
    x: clustered ? (i % 4) * 1800 + random() * 900 : (i % columns) * 320,
    y: clustered ? Math.floor(i % 8 / 4) * 1800 + random() * 900 : Math.floor(i / columns) * 210,
    width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `中文正文 ${i + 1} / Canvas` }] },
      { type: 'paragraph', content: [{ type: 'text', text: '真实 Markdown 正文保留列表、粗体和中英文排版。' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '不是手画文字或空白色块。' }] }] }] },
    ] } },
  }));
  const edges = Array.from({ length: Math.ceil(count * 1.2) }, (_, i) => CanvasEdgeSchema.parse({ ...base,
    id: `e${i + 1}`, type: 'edge', order: String(i).padStart(6, '0'), direction: 'forward', lineStyle: 'curve', label: '',
    from: { kind: 'card', cardId: cards[i % count].id, side: 'auto' },
    to: { kind: 'card', cardId: cards[(i % count + 1 + Math.floor(i / count)) % count].id, side: 'auto' },
  }));
  return [...cards, ...edges];
}

type Presentation = ReturnType<typeof createCanvasRasterPresentation>;
let kernel: CanvasKernel | null = null;
let presentation: Presentation | null = null;
let collection = 0;
let previous = 0;
let gaps: number[] = [];
let failures: string[] = [];
let elements: readonly CanvasElement[] = [];
let movedCards = 0;
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const appearance = { dark: false, material: 'paper', overview: 'titles' } as const;

async function prepare(count: number, clustered: boolean) {
  presentation?.dispose(); kernel?.destroy();
  document.body.replaceChildren(); document.body.style.cssText = 'margin:0;font-family:system-ui;background:#f1f3ed';
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0';
  const staging = document.createElement('div'); staging.className = 'canvas-raster-staging';
  document.body.append(host, staging); failures = [];
  kernel = await createPixiCanvasKernel({ host, resolution: devicePixelRatio, onIntent: (intent) => {
    if (intent.kind === 'camera') presentation?.refresh();
    if (intent.kind === 'select') kernel?.setSelection(intent.ids);
    if (intent.kind === 'move') movedCards = intent.ids.length;
  } });
  presentation = createCanvasRasterPresentation({ host: staging, kernel, readAppearance: () => appearance, reportFailure: (message) => failures.push(message) });
  const data = fixture(count, clustered);
  elements = data; movedCards = 0;
  const cards = data.filter((element): element is CanvasCard => element.type !== 'edge');
  const started = performance.now(); kernel.setElements(data); kernel.fit(cards); presentation.refresh(); await nextFrame();
  return { installMs: performance.now() - started, dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
    count, clustered, camera: kernel.readCamera(), stats: kernel.readStats(), renderStatus: kernel.readRenderStatus(), resolution: kernel.readResolution() };
}
function start() {
  cancelAnimationFrame(collection); gaps = []; previous = 0;
  const frame = (time: number) => { if (previous) gaps.push(time - previous); previous = time; collection = requestAnimationFrame(frame); };
  collection = requestAnimationFrame(frame);
}
function finish() {
  cancelAnimationFrame(collection); collection = 0;
  const sorted = gaps.slice().sort((a, b) => a - b);
  return { frames: gaps.length, elapsedMs: gaps.reduce((sum, gap) => sum + gap, 0), frameP95: sorted[Math.floor(sorted.length * 0.95)],
    worstFrame: sorted[sorted.length - 1], camera: kernel?.readCamera(), scene: kernel?.readStats(), queue: presentation?.readStats(), failures };
}
function closeView() {
  kernel?.setCamera({ x: 30, y: 30, zoom: 0.6 }); presentation?.refresh();
  return { visible: kernel?.visibleCards().length, camera: kernel?.readCamera() };
}
async function waitForBody() {
  const started = performance.now();
  while (performance.now() - started < 5000) {
    const stats = presentation?.readStats();
    if (stats?.failed) return { settled: false, ms: performance.now() - started, camera: kernel?.readCamera(), stats };
    if (stats && !stats.pending && !stats.running) {
      await nextFrame(); await nextFrame();
      const after = presentation?.readStats();
      if (after && !after.pending && !after.running) return { settled: true, ms: performance.now() - started, camera: kernel?.readCamera(), stats: after };
    }
    await nextFrame();
  }
  return { settled: false, ms: performance.now() - started, camera: kernel?.readCamera(), stats: presentation?.readStats() };
}
async function prepareDrag(selectedCount: number) {
  if (!kernel) throw new Error('probe_not_prepared');
  closeView(); await waitForBody();
  const visible = kernel.renderableCards();
  let target: { readonly card: CanvasCard; readonly point: { readonly x: number; readonly y: number } } | undefined;
  for (let i = visible.length - 1; i >= 0 && !target; i--) {
    const card = visible[i];
    for (const region of kernel.readVisibleCardRegions(card.id)) {
      const world = { x: card.x + region.x + region.width / 2, y: card.y + region.y + region.height / 2 }, point = kernel.worldToScreen(world);
      if (point.x > 20 && point.y > 20 && point.x < innerWidth - 130 && point.y < innerHeight - 80 && kernel.hitTest(world)?.id === card.id) { target = { card, point }; break; }
    }
  }
  if (!target) throw new Error('drag_fixture_safe_target_missing');
  const top = target.card;
  const selected = [top.id, ...elements.filter((element): element is CanvasCard => element.type !== 'edge' && element.id !== top.id).slice(0, selectedCount - 1).map(card => card.id)];
  kernel.setSelection(selected); movedCards = 0;
  // 为整条原生拖动轨迹保留窗口边界，不能让离开窗口的mouseup被误当作已验收。
  return { point: target.point, selected: selected.length, cardId: top.id };
}
Object.defineProperties(window, {
  prepareCanvasPerformanceProbe: { value: prepare }, startCanvasPerformanceCollection: { value: start },
  finishCanvasPerformanceCollection: { value: finish }, closeCanvasPerformanceView: { value: closeView },
  waitForCanvasPerformanceBody: { value: waitForBody },
  prepareCanvasPerformanceDrag: { value: prepareDrag }, finishCanvasPerformanceDrag: { value: () => ({ movedCards, selected: kernel?.readSelection().length }) },
});
