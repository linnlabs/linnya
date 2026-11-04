import 'pixi.js/unsafe-eval';
import { Application, Container, Rectangle, Text, Texture } from 'pixi.js';
import { CanvasIdentityAtlas } from '../../src/renderer/kernel/render/pixi/CanvasIdentityAtlas';
import { withCanvasIdentityTextRaster } from '../../src/renderer/kernel/render/pixi/canvasIdentityTextRaster';

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
    return { reservations, oldDestroyed, destroyed, restoredDestroyed, final: atlas.readStats() };
  } finally { atlas.destroy(); app.destroy(true, { children: true, texture: false }); }
}

Object.defineProperties(window, {
  canvasIdentityAtlasPixels: { value: pixels }, canvasIdentityAtlasLifecycle: { value: lifecycle },
});
