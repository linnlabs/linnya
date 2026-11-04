import { createPixiCanvasKernel } from '../../src/renderer/kernel';
import { createCanvasRasterPresentation } from '../../src/renderer/orchestration/createCanvasRasterPresentation';
import { createCanvasPerformancePaintTrace } from './performancePaintTrace';
import { createCanvasZoomTimeline, type CanvasZoomTraceState } from './performanceZoomTimeline';
import { readCanvasElementText } from '../../src/shared';
import { changeVisibleUpdateFixture, createVisibleUpdateFixture, visibleUpdateChangedFirstLines, VISIBLE_UPDATE_TEXT_FONT, type VisibleUpdateChange, type VisibleIdentityArm } from './visibleUpdateFixture';
import '@linnya/markdown-document-core/style.css';
import '../../src/renderer/features/cardRendering/styles/canvasCardInk.css';
import '../../src/renderer/styles/canvas.css';

let timeline: ReturnType<typeof createCanvasZoomTimeline> | null = null;
let frameCollector: ((timestamp: number) => void) | null = null;
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(timestamp => { timeline?.frame(timestamp); frameCollector?.(timestamp); resolve(); }));
const appearance = { dark: false, material: 'paper', overview: 'titles' } as const;
let cards: ReturnType<typeof createVisibleUpdateFixture> = [], dispose = () => {};
let paintTrace: ReturnType<typeof createCanvasPerformancePaintTrace> | null = null;
let readTraceState: (() => CanvasZoomTraceState) | undefined, capture: (() => Promise<string>) | undefined;
const paints: number[] = [];
document.addEventListener('paint', () => paints.push(performance.now()), true);
let apply: ((poll: boolean, animate: boolean) => Promise<unknown>) | undefined;

async function prepare(change: VisibleUpdateChange = 'color', identityArm: VisibleIdentityArm | null = null) {
  if (change === 'identity-control' && identityArm === null) throw new Error('identity_control_arm_required');
  dispose(); document.body.replaceChildren(); document.body.style.cssText = change !== 'color'
    ? `margin:0;font-family:${VISIBLE_UPDATE_TEXT_FONT};-webkit-font-smoothing:antialiased` : 'margin:0;font-family:system-ui';
  const host = document.createElement('div'), staging = document.createElement('div');
  if (change !== 'color') staging.className = 'canvas-raster-staging';
  host.style.cssText = 'position:fixed;inset:0'; document.body.append(host, staging);
  const kernel = await createPixiCanvasKernel({ host, resolution: devicePixelRatio });
  const failures: string[] = [], raster = createCanvasRasterPresentation({ host: staging, kernel, suspendWhenHidden: false,
    readAppearance: () => appearance, reportFailure: message => failures.push(message) });
  cards = createVisibleUpdateFixture(change); let round = 20;
  const ids = cards.map(card => card.id);
  const settle = async (poll: boolean, started = performance.now()) => {
    let polls = 0, firstAnyMs: number | null = null, allVisibleMs: number | null = null;
    const observed = () => {
      const readiness = raster.readReadiness(ids);
      if (poll && readiness.cards.some(card => card.mode === 'body' && card.firstPresented) && firstAnyMs === null) firstAnyMs = performance.now() - started;
      if (poll && readiness.cards.length === 500 && readiness.cards.every(card => card.mode === 'body' && card.firstPresented) && allVisibleMs === null) allVisibleMs = performance.now() - started;
      return readiness;
    };
    for (;;) {
      await nextFrame(); if (poll) { observed(); polls++; }
      const stats = raster.readStats(); if (stats.failed || performance.now() - started > 10000) throw new Error(`visible_update_did_not_settle:${JSON.stringify({ stats, failures })}`);
      if (!stats.running && !stats.pending) {
        await nextFrame(); const readiness = observed();
        if (readiness.complete) return { polls, readiness, firstAnyMs, allVisibleMs };
      }
    }
  };
  kernel.setElements(cards); kernel.fit(cards);
  let identityWarm: { readonly renders: number; readonly bitmaps: number } | null = null;
  if (change === 'identity-control') {
    const started = performance.now();
    do { await nextFrame(); if (performance.now() - started > 10000) throw new Error('identity_control_seed_labels_not_drawn'); } while (!kernel.readStats().renders);
    const stats = kernel.readStats(); identityWarm = { renders: stats.renders, bitmaps: stats.bitmaps };
    if (stats.bitmaps || stats.renderableCards !== 500) throw new Error('identity_control_seed_warm_included_body_or_missing_cards');
  }
  raster.refresh(); await settle(false);
  const expectedCamera = { x: 92.52293577981652, y: 40, zoom: 0.4701834862385321 }, camera = kernel.readCamera();
  if (change !== 'color' && (innerWidth !== 1400 || innerHeight !== 900 || devicePixelRatio !== 2
    || Math.abs(camera.x - expectedCamera.x) > 1e-9 || Math.abs(camera.y - expectedCamera.y) > 1e-9 || Math.abs(camera.zoom - expectedCamera.zoom) > 1e-12)) throw new Error('visible_text_fixture_environment_does_not_match_r4');
  readTraceState = () => {
    const scene = kernel.readStats(), queue = raster.readStats();
    return { renders: scene.renders, rasterCards: scene.rasterCards, bitmaps: scene.bitmaps, bitmapBytes: scene.bitmapBytes,
      fadingCards: scene.fadingCards, pending: queue.pending, running: queue.running, completed: queue.completed,
      activeImages: 0, activePreviews: 0, activeReferences: 0 };
  };
  capture = () => kernel.captureImage('png');
  apply = async (poll, animate) => {
    paints.length = 0; const frameIntervalsMs: number[] = []; let lastFrame: number | null = null;
    frameCollector = timestamp => { if (lastFrame !== null) frameIntervalsMs.push(timestamp - lastFrame); lastFrame = timestamp; };
    await nextFrame();
    const started = performance.now(), previousDraw = kernel.readStats().renders;
    if (timeline) performance.mark('canvas-probe:visible-update-input');
    const before = cards; cards = changeVisibleUpdateFixture(cards, change, ++round, identityArm);
    const changedFirstLines = change === 'identity-control' ? visibleUpdateChangedFirstLines(before, cards) : null;
    if (change === 'identity-control' && changedFirstLines !== (identityArm === 'stable' ? 0 : 500)) throw new Error('identity_control_did_not_isolate_first_line');
    const revisions = new Map(cards.map(card => [card.id, card.revision]));
    kernel.setElements(cards, animate ? { animateIds: ids } : {}); raster.refresh(); const projected = performance.now();
    do { await nextFrame(); if (performance.now() - started > 10000) throw new Error('visible_update_geometry_draw_missing'); } while (kernel.readStats().renders <= previousDraw);
    const geometry = performance.now(); const settled = await settle(poll, started); frameCollector = null;
    const readiness = settled.readiness;
    if (kernel.readStats().renders <= previousDraw || readiness.cards.length !== 500
      || readiness.cards.some(card => card.mode !== 'body' || card.status !== 'ready' || card.revision !== revisions.get(card.id))) throw new Error('visible_update_body_not_drawn');
    return { measurement: 'kernel-input-to-current-body-draw', backendMeasured: false, validHardwareRun: false,
      diagnostic: 'isolated-renderer-current-new-body', change, identityArm, changedFirstLines, textRound: change === 'color' ? null : round,
      ...(change === 'identity-control' ? { firstLines: cards.map(card => readCanvasElementText(card).split('\n')[0]) } : {}),
      cards: cards.length, poll, animate, polls: settled.polls, projectMs: projected - started, geometryMs: geometry - started,
      firstAnyMs: settled.firstAnyMs, allVisibleMs: settled.allVisibleMs, firstPresentationObserved: poll,
      bodyMs: performance.now() - started, timeOrigin: performance.timeOrigin, inputAt: started, frameIntervalsMs,
      paints: paints.map(time => time - started), scene: kernel.readStats(), queue: raster.readStats(), failures };
  };
  dispose = () => { frameCollector = null; timeline?.finish(); timeline = null; paintTrace?.finish(); paintTrace = null;
    raster.dispose(); kernel.destroy(); apply = undefined; capture = undefined; readTraceState = undefined; };
  return { change, identityArm, identityWarm,
    ...(change === 'identity-control' ? { firstLines: cards.map(card => readCanvasElementText(card).split('\n')[0]) } : {}),
    fixture: change === 'identity-control' ? 'two-paragraphs-common500-glyph-warm-first-line-control'
    : change === 'text' ? 'r4-before-round21-first500-logical-state-no-20-warm-writes' : 'historical-color-update',
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, fontFamily: getComputedStyle(staging).fontFamily,
    fontSmoothing: getComputedStyle(staging).getPropertyValue('-webkit-font-smoothing'), camera: kernel.readCamera(), scene: kernel.readStats(), queue: raster.readStats() };
}
Object.defineProperties(window, {
  prepareVisibleUpdateProbe: { value: prepare },
  updateVisibleUpdateProbe: { value: (poll: boolean, animate = false) => { if (!apply) throw new Error('visible_update_not_prepared'); return apply(poll, animate); } },
  beginCanvasPerformancePaintTrace: { value: () => { paintTrace?.finish(); paintTrace = createCanvasPerformancePaintTrace(); } },
  finishCanvasPerformancePaintTrace: { value: () => { const result = paintTrace?.finish(); paintTrace = null; return result; } },
  startVisibleUpdateTrace: { value: () => { if (!readTraceState) throw new Error('visible_update_not_prepared'); timeline = createCanvasZoomTimeline(readTraceState, 'visible-update'); } },
  finishVisibleUpdateTrace: { value: () => { const result = timeline?.finish(); timeline = null; return result; } },
  captureVisibleUpdateProbe: { value: () => { if (!capture) throw new Error('visible_update_not_prepared'); return capture(); } },
});
