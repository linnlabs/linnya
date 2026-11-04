import 'pixi.js/unsafe-eval';
import { Application, Container, Rectangle, Text, Texture } from 'pixi.js';
import { CanvasIdentityAtlas, CanvasIdentityAtlasCapacityError } from '../../src/renderer/kernel/render/pixi/CanvasIdentityAtlas';
import { withCanvasIdentityTextRaster } from '../../src/renderer/kernel/render/pixi/canvasIdentityTextRaster';
import { createPixiCanvasKernel } from '../../src/renderer/kernel';
import { createVisibleUpdateFixture } from './visibleUpdateFixture';
import { CanvasImageCardSchema } from '../../src/shared';
import { createCanvasCardTextureCaches } from '../../src/renderer/kernel/render/pixi/createCanvasCardTextureCaches';
import { CanvasMapLabels } from '../../src/renderer/kernel/render/pixi/CanvasMapLabels';
import { createCanvasPerformancePaintTrace } from './performancePaintTrace';
import { collectCanvasTitleBoundaryPixels } from './identityTitleBoundaryRenderer';

const strings = ['中文身份牌：春江花月夜', 'office affinity ffi AV', 'e\u0301 A\u030a 组合附加符',
  '👨‍👩‍👧‍👦 🇨🇳 👍🏽 ❤️', 'العَرَبِيَّةُ لا سلام', 'नमस्ते दुनिया क्ष', '日本語かなカナ 한글', '末行边界　（）【】'];

async function pixels(resolution: number, zoom: number) {
  const app = new Application();
  await app.init({ width: 1300, height: 850, resolution, autoStart: false, preference: 'webgl', antialias: true, backgroundAlpha: 0 });
  const atlas = new CanvasIdentityAtlas({ budget: 8 * 1024 * 1024, reserve() {} });
  try {
    const expected = new Container(), actual = new Container();
    expected.position.set(16.25, 16.25); actual.position.set(656.25, 16.25);
    expected.scale.set(zoom); actual.scale.set(zoom); app.stage.addChild(expected, actual);
    strings.forEach((text, index) => {
      const reference = new Text({ text, resolution, style: { fill: 0xffffff, fontFamily: 'system-ui', fontSize: 15, wordWrap: false } });
      const sprite = atlas.create(text); atlas.setActive(sprite, true);
      reference.y = sprite.y = index * 48; reference.tint = sprite.tint = index % 2 ? 0x2d6541 : 0xffffff;
      expected.addChild(reference); actual.addChild(sprite);
    });
    atlas.flush(resolution); app.render();
    const reference = await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(0, 0, 600, 800), resolution });
    const image = await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(640, 0, 600, 800), resolution });
    return { resolution, zoom, strings, reference, image, stats: atlas.readStats() };
  } finally { atlas.destroy(); app.destroy(true, { children: true, texture: false }); }
}

async function lifecycle() {
  const app = new Application();
  await app.init({ width: 300, height: 150, autoStart: false, preference: 'webgl' });
  const reservations: number[] = [], atlas = new CanvasIdentityAtlas({ budget: 2 * 1024 * 1024, reserve: bytes => { reservations.push(bytes); } });
  try {
    const first = atlas.create('整串共享'), second = atlas.create('整串共享');
    second.y = 50; app.stage.addChild(first, second); atlas.setActive(first, true); atlas.setActive(second, true);
    atlas.flush(1); app.render();
    if (first.texture !== second.texture || atlas.readStats().identityEntries !== 1) throw new Error('identity_same_string_not_shared');
    const oldSource = first.texture.source; let oldDestroyed = 0;
    oldSource.on('destroy', () => { oldDestroyed++; });
    // 同一页预算必须足够完成DPR升级，不能要求瞬时保留旧/新两页。
    atlas.flush(2); app.render();
    if (oldDestroyed !== 1 || first.texture.source === oldSource || first.texture.source.resolution !== 2) throw new Error('identity_dpr_replacement_leaked_old_page');
    const source = first.texture.source; let destroyed = 0; source.on('destroy', () => { destroyed++; });
    atlas.remove(first); first.destroy();
    if (destroyed || atlas.readStats().identityEntries !== 1) throw new Error('identity_shared_source_destroyed_early');
    atlas.setActive(second, false); atlas.trimTo(0);
    if (destroyed !== 1 || second.texture !== Texture.EMPTY || atlas.readBytes()) throw new Error('identity_inactive_eviction_left_binding_or_source');
    atlas.setActive(second, true); atlas.flush(2); app.render();
    const restored = second.texture.source; let restoredDestroyed = 0; restored.on('destroy', () => { restoredDestroyed++; });
    atlas.remove(second); second.destroy();
    if (restoredDestroyed !== 1 || atlas.readBytes() || atlas.readStats().identityEntries) throw new Error('identity_last_view_did_not_release_page');
    const failure = new Error('expected-consumer-failure'); let caught = false;
    try { withCanvasIdentityTextRaster('失败后仍可借用', 2, () => { throw failure; }); }
    catch (error) { if (error !== failure) throw error; caught = true; }
    if (!caught) throw new Error('identity_raster_consumer_failure_swallowed');
    const recovered = withCanvasIdentityTextRaster('失败后仍可借用', 2, raster => raster.width > 0);
    if (!recovered) throw new Error('identity_borrowed_canvas_not_reusable_after_failure');
    const constrained = new CanvasIdentityAtlas({ budget: 1, reserve() { throw new Error('identity_unadmitted_page_reached_reservation'); } });
    const tooLarge = constrained.create('预算在持有新页之前检查'); constrained.setActive(tooLarge, true);
    let capacityRejected = false, cachedFailure = false;
    try {
      let original: CanvasIdentityAtlasCapacityError | null = null;
      try { constrained.flush(1); }
      catch (error) { if (!(error instanceof CanvasIdentityAtlasCapacityError)) throw error; capacityRejected = true; original = error; }
      if (constrained.needsPreparation(1)) throw new Error('identity_capacity_failure_retries_without_input');
      try { constrained.flush(1); } catch (error) { if (error !== original) throw error; cachedFailure = true; }
      if (!cachedFailure) throw new Error('identity_capacity_failure_became_capture_success');
      constrained.setActive(tooLarge, false);
      if (!constrained.needsPreparation(1)) throw new Error('identity_capacity_input_did_not_enable_recovery');
      constrained.flush(1);
    } finally { constrained.remove(tooLarge); tooLarge.destroy(); constrained.destroy(); }
    if (!capacityRejected || constrained.readBytes()) throw new Error('identity_over_budget_page_was_published');
    return { reservations, oldDestroyed, destroyed, restoredDestroyed, capacityRejected, cachedFailure, final: atlas.readStats() };
  } finally { atlas.destroy(); app.destroy(true, { children: true, texture: false }); }
}

async function contextRestoration() {
  const host = document.createElement('div'); host.style.cssText = 'width:360px;height:240px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 360, height: 240, resolution: 2 });
  try {
    kernel.setElements(createVisibleUpdateFixture('text').slice(0, 1));
    const wait = async (ready: () => boolean, code: string) => {
      const started = performance.now();
      while (!ready()) {
        if (performance.now() - started > 5000) throw new Error(code);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    };
    await wait(() => kernel.readStats().renders > 0, 'identity_context_initial_draw_missing');
    const before = await kernel.captureImage('png'), initial = kernel.readStats();
    if (initial.bitmaps || initial.identityPages !== 1) throw new Error('identity_context_fixture_included_body');
    const gl = kernel.canvas.getContext('webgl2') ?? kernel.canvas.getContext('webgl'), extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('identity_context_extension_unavailable');
    extension.loseContext(); await wait(() => kernel.readRenderStatus().phase === 'restoring', 'identity_context_loss_not_observed');
    let rejected = false;
    try { await kernel.captureImage('png'); } catch (error) { rejected = error instanceof Error && error.message === 'canvas_graphics_context_lost'; }
    if (!rejected) throw new Error('identity_lost_context_capture_was_not_rejected');
    extension.restoreContext();
    await wait(() => kernel.readRenderStatus().phase === 'ready' && kernel.readStats().renders > initial.renders, 'identity_context_restore_draw_missing');
    return { before, image: await kernel.captureImage('png'), initial, restored: kernel.readStats(), rejected };
  } finally { kernel.destroy(); host.remove(); }
}

async function hiddenLod() {
  const host = document.createElement('div'); host.style.cssText = 'width:360px;height:240px'; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width: 360, height: 240, resolution: 2 });
  try {
    const text = createVisibleUpdateFixture('text')[0], image = CanvasImageCardSchema.parse({ ...text, id: 'c2', type: 'image', x: 110,
      data: { assetId: 'identity-lod-probe', alt: '图片身份牌', caption: '', crop: null } });
    kernel.setAppearance({ dark: false, material: 'paper', overview: 'thumbnails' }); kernel.setElements([text, image]);
    await kernel.captureImage('png'); const visible = kernel.readStats();
    kernel.setCamera({ x: 20, y: 20, zoom: 0.1 }); const smallImage = await kernel.captureImage('png'), small = kernel.readStats();
    // 同一低倍率的pan走非style路径，也不能重新打开已经隐藏的身份牌。
    kernel.setCamera({ x: 21, y: 21, zoom: 0.1 }); await kernel.captureImage('png'); const panned = kernel.readStats();
    kernel.setElements([]); await kernel.captureImage('png'); const cleared = kernel.readStats();
    return { visible, small, panned, cleared, smallImage };
  } finally { kernel.destroy(); host.remove(); }
}

async function sharedBudget() {
  const total = 2 * 1024 * 1024 + 20000, app = new Application();
  await app.init({ width: 200, height: 150, autoStart: false, preference: 'webgl' });
  const caches = createCanvasCardTextureCaches({ textureBudgetBytes: total, bitmapBudgetBytes: 40000,
    readRenderCount: () => 0, requestDraw() {}, changed() {} });
  const body = new Container(), label = caches.identities.create('双向准入'); app.stage.addChild(body, label);
  const source = new OffscreenCanvas(100, 100), context = source.getContext('2d'); if (!context) throw new Error('shared_budget_fixture_context_missing');
  context.fillStyle = '#1256bb'; context.fillRect(0, 0, 100, 100);
  const first = await createImageBitmap(source), second = await createImageBitmap(source), id = createVisibleUpdateFixture('text')[0].id;
  const stats = () => ({ bodyBytes: caches.bitmaps.readStats().bitmapBytes, identityBytes: caches.identities.readBytes() });
  const tile = (bitmap: ImageBitmap) => ({ bitmap, x: 0, y: 0, width: 100, height: 100, scale: 1 });
  try {
    caches.bitmaps.install(id, 'first', [tile(first)], body); const initial = stats();
    caches.identities.setActive(label, true); caches.identities.flush(1); app.render(); const atlasWins = stats(), firstClosed = first.width === 0;
    label.visible = false; caches.identities.setActive(label, false);
    const installed = caches.bitmaps.install(id, 'second', [tile(second)], body); app.render(); const bodyWins = stats();
    caches.bitmaps.clear(); caches.identities.remove(label); const cleared = stats();
    return { total, initial, atlasWins, bodyWins, cleared, firstClosed, secondClosed: second.width === 0, installed };
  } finally {
    caches.bitmaps.clear(); caches.identities.destroy();
    if (first.width) first.close(); if (second.width) second.close();
    app.destroy(true, { children: true, texture: false });
  }
}

async function emptyMap() {
  const app = new Application();
  await app.init({ width: 300, height: 150, autoStart: false, preference: 'webgl', backgroundAlpha: 0 });
  const map = new CanvasMapLabels(), reference = new CanvasMapLabels(), cards = createVisibleUpdateFixture('text').slice(0, 1);
  let title = '旧标题：春江花月夜', trace: ReturnType<typeof createCanvasPerformancePaintTrace> | null = null;
  const input = (entries: typeof cards, zoom = 0.1) => ({ cards: entries, camera: { x: 20, y: 20, zoom }, width: 300, height: 150,
    dark: false, visible: true, readTitle: () => title });
  try {
    app.stage.addChild(map.sprite); map.draw(input(cards)); app.render();
    const before = await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(0, 0, 300, 150) });
    trace = createCanvasPerformancePaintTrace();
    for (let i = 0; i < 10; i++) { map.draw(input([], 0.1 + i * 0.001)); app.render(); }
    const empty = trace.finish(); trace = null;
    const hidden = !map.sprite.visible && !map.hasLabel(cards[0].id);
    title = '新标题：不同字样';
    trace = createCanvasPerformancePaintTrace(); map.draw(input(cards)); app.render();
    const restored = trace.finish(); trace = null;
    const image = await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(0, 0, 300, 150) });
    map.sprite.visible = false; app.stage.addChild(reference.sprite); reference.draw(input(cards)); app.render();
    const expected = await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(0, 0, 300, 150) });
    return { before, image, expected, hidden, empty, restored };
  } finally { trace?.finish(); map.destroy(); reference.destroy(); app.destroy(true, { children: true, texture: false }); }
}

Object.defineProperties(window, {
  canvasIdentityAtlasPixels: { value: pixels }, canvasIdentityAtlasLifecycle: { value: lifecycle },
  canvasIdentityAtlasContext: { value: contextRestoration },
  canvasIdentityAtlasHiddenLod: { value: hiddenLod },
  canvasIdentityAtlasSharedBudget: { value: sharedBudget },
  canvasEmptyMapLabels: { value: emptyMap },
  canvasTitleBoundaryPixels: { value: collectCanvasTitleBoundaryPixels },
});
