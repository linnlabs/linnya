import { CanvasCardSchema, CanvasEdgeSchema, type CanvasCard, type CanvasElement } from '../../src/shared';
import { createPixiCanvasKernel, type CanvasKernel } from '../../src/renderer/kernel';
import { createCanvasRasterPresentation } from '../../src/renderer/orchestration/createCanvasRasterPresentation';
import { canvasPerformanceMediaFixture, type CanvasPerformanceKind } from './performanceMediaFixture';
import { createCanvasZoomTimeline } from './performanceZoomTimeline';
import { createCanvasPerformancePaintTrace } from './performancePaintTrace';
import { waitForCanvasPerformanceBody } from './waitForCanvasPerformanceBody';
import { waitForCanvasPerformanceDraw } from './waitForCanvasPerformanceDraw';
import { createCanvasPerformanceInputTrace } from './performanceInputTrace';
import { createCanvasDocumentFocusSpan } from './performanceFocusQualification';
import { createCanvasStagingContextControl, type CanvasStagingContextArm } from './performanceStagingContextControl';
import '@linnya/markdown-document-core/style.css';
import '../../src/renderer/features/cardRendering/styles/canvasCardInk.css';
import '../../src/renderer/features/cardRendering/styles/canvasMediaContent.css';
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
let media: Awaited<ReturnType<typeof canvasPerformanceMediaFixture>> | null = null;
let stopMedia: (() => void) | undefined;
let collection = 0;
let previous: number | null = null;
let gaps: number[] = [];
let failures: string[] = [];
let elements: readonly CanvasElement[] = [];
let movedCards = 0;
let zoomTimeline: ReturnType<typeof createCanvasZoomTimeline> | null = null;
let paintTrace: ReturnType<typeof createCanvasPerformancePaintTrace> | null = null;
let inputTrace: ReturnType<typeof createCanvasPerformanceInputTrace> | null = null;
let focusSpan: ReturnType<typeof createCanvasDocumentFocusSpan> | null = null;
let bodyTrace: { readonly marks: { readonly name: string; readonly atMs: number; readonly rafTimestamp?: number }[] } | null = null;
let contextControl: ReturnType<typeof createCanvasStagingContextControl> | null = null;
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const appearance = { dark: false, material: 'paper', overview: 'titles' } as const;

function markBody(name: 'baseline' | 'close-start' | 'close-return' | 'wait-start' | 'wait-return' | 'finish', rafTimestamp?: number): void {
  if (!bodyTrace) return;
  const atMs = performance.now(), ownedName = `canvas-body:${name}`;
  performance.mark(ownedName, { startTime: atMs });
  bodyTrace.marks.push({ name: ownedName, atMs, ...(rafTimestamp === undefined ? {} : { rafTimestamp }) });
}

async function prepare(count: number, clustered: boolean, kind: CanvasPerformanceKind = 'text', contextArm?: CanvasStagingContextArm) {
  contextControl?.finish(); contextControl = null;
  stopMedia?.(); media?.content?.dispose(); presentation?.dispose(); kernel?.destroy();
  document.body.replaceChildren(); document.body.style.cssText = 'margin:0;font-family:system-ui;background:#f1f3ed';
  // hook先于本轮任何Canvas创建；后设hint可能命中已建context，不能拿来当B臂。
  if (contextArm) contextControl = createCanvasStagingContextControl(contextArm);
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:#f1f3ed';
  const staging = document.createElement('div'); staging.className = 'canvas-raster-staging';
  document.body.append(host, staging); failures = [];
  const openingStarted = performance.now();
  kernel = await createPixiCanvasKernel({ host, resolution: devicePixelRatio, onIntent: (intent) => {
    inputTrace?.intent(intent);
    if (intent.kind === 'camera' || intent.kind === 'preview-changed') { media?.content?.refreshVisible(kernel?.renderableCards() ?? []); presentation?.refresh(); }
    if (intent.kind === 'select') kernel?.setSelection(intent.ids);
    if (intent.kind === 'move') movedCards = intent.ids.length;
  } });
  const kernelReadyMs = performance.now() - openingStarted;
  media = await canvasPerformanceMediaFixture(fixture(count, clustered), kind); const data = media.elements;
  presentation = createCanvasRasterPresentation({ host: staging, kernel, createContent: media.content?.create, readContentKey: media.content?.contentKey, suspendWhenHidden: false, readAppearance: () => appearance, reportFailure: (message) => failures.push(message) });
  elements = data; movedCards = 0;
  const cards = data.filter((element): element is CanvasCard => element.type !== 'edge');
  let scheduled = false, disposed = false;
  const unsubscribe = media.content?.subscribe(failure => {
    if (failure) { failures.push(failure.message); return; }
    if (scheduled) return; scheduled = true; queueMicrotask(() => {
      scheduled = false; if (disposed || !kernel || !media?.content) return;
      kernel.setDocumentTitles(media.content.documentTitles()); kernel.setThumbnailCards(media.content.thumbnailCards(cards)); media.content.refreshVisible(kernel.renderableCards()); presentation?.refresh();
    });
  });
  stopMedia = () => { disposed = true; unsubscribe?.(); };
  const preparedKernel = kernel, started = performance.now(), previousRenders = preparedKernel.readStats().renders;
  kernel.setElements(data); kernel.fit(cards);
  void media.content?.refreshReferences(cards).catch(error => failures.push(String(error)));
  media.content?.refreshVisible(kernel.renderableCards()); presentation.refresh();
  await waitForCanvasPerformanceDraw(previousRenders, { readRenderCount: () => preparedKernel.readStats().renders, now: () => performance.now(), nextFrame });
  return { installMs: performance.now() - started, kernelReadyMs, firstFrameMs: performance.now() - openingStarted, dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
    count, clustered, kind, resource: media.readStats(), camera: kernel.readCamera(), stats: kernel.readStats(), renderStatus: kernel.readRenderStatus(), resolution: kernel.readResolution() };
}
function start(baseline?: (time: number) => void) {
  focusSpan?.finish(); focusSpan = createCanvasDocumentFocusSpan();
  cancelAnimationFrame(collection); gaps = []; previous = null;
  const frame = (time: number) => { zoomTimeline?.frame(time); if (previous !== null) gaps.push(time - previous); else baseline?.(time); previous = time; collection = requestAnimationFrame(frame); };
  collection = requestAnimationFrame(frame);
  return { documentFocus: focusSpan.start };
}
function startBaseline(traceBody = false): Promise<number> {
  if (!traceBody) return new Promise(resolve => start(resolve));
  bodyTrace = { marks: [] };
  return new Promise(resolve => start(time => { markBody('baseline', time); resolve(time); }));
}
function finish() {
  cancelAnimationFrame(collection); collection = 0;
  const documentFocus = focusSpan?.finish(); focusSpan = null;
  const sorted = gaps.slice().sort((a, b) => a - b);
  const result = { frames: gaps.length, frameIntervalsMs: gaps, elapsedMs: gaps.reduce((sum, gap) => sum + gap, 0), frameP95: sorted[Math.floor(sorted.length * 0.95)],
    worstFrame: sorted[sorted.length - 1], camera: kernel?.readCamera(), scene: kernel?.readStats(), queue: presentation?.readStats(), media: media?.readStats(), failures, documentFocus };
  if (!bodyTrace) return result;
  markBody('finish');
  const bodyClock = { clock: 'unmodified-performance.now', timeOrigin: performance.timeOrigin, marks: bodyTrace.marks };
  // trace已接收UserTiming事件；只清理由本段创建的有限标记，不影响其它夹具或产品观测。
  for (const mark of bodyTrace.marks) performance.clearMarks(mark.name);
  bodyTrace = null;
  return { ...result, bodyClock };
}
function closeView() {
  markBody('close-start');
  kernel?.setCamera({ x: 30, y: 30, zoom: 0.6 }); media?.content?.refreshVisible(kernel?.renderableCards() ?? []); presentation?.refresh();
  markBody('close-return');
  return { visible: kernel?.visibleCards().length, camera: kernel?.readCamera() };
}
async function waitForBody() {
  markBody('wait-start');
  const { settled, ms, snapshot } = await waitForCanvasPerformanceBody({ now: () => performance.now(), nextFrame,
    readSnapshot: () => ({ stats: presentation?.readStats(), camera: kernel?.readCamera(), media: media?.readStats(),
      resourcesIdle: mediaResourcesIdle(), fadingCards: kernel?.readStats().fadingCards ?? 0, presentationReady: bodyPresentationReady() }) });
  markBody('wait-return');
  return { settled, ms, camera: snapshot.camera, stats: snapshot.stats, media: snapshot.media };
}
function mediaResourcesIdle(): boolean {
  const active = media?.readStats().active;
  return !active || active.image + active.preview + active.reference === 0;
}
function bodyPresentationReady(): boolean {
  if (!kernel || !presentation) return false;
  if (kernel.readCamera().zoom >= 0.3) return presentation.readReadiness(kernel.rasterCards().map(card => card.id)).complete;
  if (!media?.content) return true;
  // 资源响应已返回不代表最后一批通知已投影；按夹具owner事实等齐应显示的缩略图。
  const expected = kernel.renderableCards().filter(card => media?.expectedThumbnails.has(card.id)).length;
  const stats = kernel.readStats(); return stats.rasterCards === expected && stats.bitmaps >= expected;
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
  finishCanvasPerformanceStagingContextControl: { value: () => { const result = contextControl?.finish(); contextControl = null; return result; } },
  beginCanvasPerformanceInputTrace: { value: () => {
    inputTrace?.finish(); inputTrace = createCanvasPerformanceInputTrace({ readCanvas: () => kernel?.canvas ?? null,
      readState: point => {
        const focus = { document: document.hasFocus(), activeIsMainCanvas: document.activeElement === kernel?.canvas };
        if (!kernel) return { focus, prepared: false };
        const hit = point ? kernel.hitTest(kernel.screenToWorld(point)) : null, selection = kernel.readSelection();
        const receiptIds = hit ? [hit.id] : selection.slice(0, 1);
        return { focus, camera: kernel.readCamera(), selection, hitId: hit?.id ?? null, renders: kernel.readStats().renders,
          currentReceipt: presentation?.readReadiness(receiptIds) ?? null };
      } });
  } },
  finishCanvasPerformanceInputTrace: { value: () => { const result = inputTrace?.finish(); inputTrace = null; return result; } },
  beginCanvasPerformancePaintTrace: { value: () => { paintTrace?.finish(); paintTrace = createCanvasPerformancePaintTrace(); } },
  finishCanvasPerformancePaintTrace: { value: () => { const result = paintTrace?.finish(); paintTrace = null; return result; } },
  startCanvasPerformanceZoomTrace: { value: (detailed = false) => {
    zoomTimeline = createCanvasZoomTimeline(() => {
      if (!kernel || !presentation || !media) throw new Error('probe_not_prepared');
      const scene = kernel.readStats(), queue = presentation.readStats(), active = media.readStats().active;
      return { renders: scene.renders, rasterCards: scene.rasterCards, bitmaps: scene.bitmaps, bitmapBytes: scene.bitmapBytes,
        fadingCards: scene.fadingCards, pending: queue.pending, running: queue.running, completed: queue.completed,
        activeImages: active.image, activePreviews: active.preview, activeReferences: active.reference,
        ...(detailed ? { camera: kernel.readCamera(), viewportCards: scene.viewportCards, identityBytes: scene.identityBytes,
          requestedTiles: queue.requestedTiles, requestedPixels: queue.requestedPixels, discarded: queue.discarded } : {}) };
    }, 'zoom', detailed);
  } },
  finishCanvasPerformanceZoomTrace: { value: () => { const result = zoomTimeline?.finish(); zoomTimeline = null; return result; } },
  prepareCanvasPerformanceProbe: { value: prepare }, startCanvasPerformanceCollection: { value: start }, startCanvasPerformanceBaseline: { value: startBaseline },
  finishCanvasPerformanceCollection: { value: finish }, closeCanvasPerformanceView: { value: closeView },
  waitForCanvasPerformanceBody: { value: waitForBody }, readCanvasPerformanceMedia: { value: () => media?.readStats() },
  captureCanvasPerformanceFrame: { value: () => { if (!kernel) throw new Error('probe_not_prepared'); return kernel.captureImage('png'); } },
  prepareCanvasPerformanceDrag: { value: prepareDrag }, finishCanvasPerformanceDrag: { value: () => { const result = { movedCards, selected: kernel?.readSelection().length }; kernel?.clearDragPreview(); presentation?.refresh(); return result; } },
});

// 以fixture事实作独立线性oracle；不借用生产索引来证明索引自己正确。
function deterministicCounts() {
  if (!kernel || !presentation) throw new Error('probe_not_prepared');
  const camera = kernel.readCamera(), cards = elements.filter((element): element is CanvasCard => element.type !== 'edge');
  const viewport = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, width: innerWidth / camera.zoom, height: innerHeight / camera.zoom };
  const expected = cards.filter(card => card.x <= viewport.x + viewport.width && card.x + card.width >= viewport.x
    && card.y <= viewport.y + viewport.height && card.y + card.height >= viewport.y).map(card => card.id).sort();
  const actual = kernel.visibleCards().map(card => card.id).sort();
  const probes = cards.slice(0, 20).map(card => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 }));
  const hits = probes.map(point => {
    const expected = cards.slice().reverse().find(card => point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height);
    return { expected: expected?.id ?? null, actual: kernel?.hitTest(point)?.id ?? null, candidates: kernel?.readStats().spatialHitCandidates };
  });
  const regions = kernel.renderableCards().flatMap(card => kernel?.readVisibleCardRegions(card.id).map(region => ({ card, region })) ?? []);
  const invalidRegions = regions.filter(({ card, region }) => region.width <= 0 || region.height <= 0 || region.x < 0 || region.y < 0
    || region.x + region.width > card.width + 1e-8 || region.y + region.height > card.height + 1e-8).length;
  return { expectedVisibleIds: expected, actualVisibleIds: actual, hits, invalidRegions, visibleRegions: regions.length,
    scene: kernel.readStats(), queue: presentation.readStats() };
}
Object.defineProperty(window, 'verifyCanvasDeterministicCounts', { value: deterministicCounts });
