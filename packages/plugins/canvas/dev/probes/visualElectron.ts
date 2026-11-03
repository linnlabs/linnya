import { app, BrowserWindow, nativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

const rectangle = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const prepared = z.object({ viewportWidth: z.number(), viewportHeight: z.number(), dpr: z.number(), reference: rectangle, raster: rectangle, pixi: rectangle, ghostY: z.number(), measuredHeights: z.array(z.number().nullable()) });
const output = process.argv[2];
if (!output) throw new Error('Visual output directory required');
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});

async function run() {
  await app.whenReady();
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const win = new BrowserWindow({ show: false, width: 2400, height: 1200, webPreferences: { sandbox: true, contextIsolation: true,
    offscreen: true, backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  win.webContents.on('console-message', details => { if (details.level === 'error' || details.level === 'warning') console.error(details.message); });
  try {
    await win.loadFile(path.join(output, 'index.html'));
    win.webContents.setZoomFactor(2);
    const reports = [];
    for (const theme of ['light', 'dark']) for (const material of ['paper', 'card']) for (const color of material === 'paper' ? ['white', 'red', 'green'] : ['white']) {
      const state = prepared.parse(await win.webContents.executeJavaScript(`window.prepareCanvasVisualProbe(${JSON.stringify(theme)},${JSON.stringify(material)},${JSON.stringify(color)})`));
      const screenshot = nativeImage.createFromBuffer((await win.webContents.capturePage()).toPNG());
      const size = screenshot.getSize();
      const ratio = size.width / state.viewportWidth;
      const crop = (rect: z.infer<typeof rectangle>) => screenshot.crop({ x: Math.round(rect.x * ratio), y: Math.round(rect.y * ratio),
        width: Math.round(rect.width * ratio), height: Math.round(rect.height * ratio) });
      const dom = crop(state.reference); const raster = crop(state.raster); const pixi = crop(state.pixi);
      const a = dom.toBitmap(); const b = raster.toBitmap(); const c = pixi.toBitmap();
      if (a.length !== b.length || a.length !== c.length || !a.length) throw new Error('visual_sizes_mismatch');
      const width = dom.getSize().width;
      const ink = (pixels: Uint8Array, i: number) => theme === 'light' ? pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180
        : pixels[i] > 150 && pixels[i + 1] > 150 && pixels[i + 2] > 150;
      let left = width; let right = 0; let top = dom.getSize().height; let bottom = 0;
      for (let i = 0; i < a.length; i += 4) if (ink(a, i)) {
        const x = i / 4 % width; const y = Math.floor(i / 4 / width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      let referenceInk = 0; let rasterInk = 0; let intersection = 0; let union = 0;
      let pixiInk = 0; let pixiIntersection = 0; let pixiUnion = 0;
      let crossedText = 0, preservedText = 0;
      const authored = { dom: 0, raster: 0, pixi: 0 };
      for (let i = 0; i < a.length; i += 4) {
        const aa = ink(a, i); const bb = ink(b, i); const cc = ink(c, i);
        const red = (pixels: Uint8Array) => pixels[i + 2] > 160 && pixels[i + 1] < 80 && pixels[i] < 80;
        if (red(a)) authored.dom++; if (red(b)) authored.raster++; if (red(c)) authored.pixi++;
        if (aa) referenceInk++; if (bb) rasterInk++; if (aa && bb) intersection++; if (aa || bb) union++;
        // Pixi 包含纸片阴影/边框；正文比较区来自实时 DOM 墨迹范围，不锁定外观数值。
        const x = i / 4 % width; const y = Math.floor(i / 4 / width);
        if (Math.abs(y / state.dpr - state.ghostY) < 2 && aa) { crossedText++; if (cc) preservedText++; }
        if (x >= left && x <= right && y >= top && y <= bottom) {
          if (cc) pixiInk++; if (aa && cc) pixiIntersection++; if (aa || cc) pixiUnion++;
        }
      }
      const inkIou = intersection / union;
      const pixiIou = pixiIntersection / pixiUnion;
      const ghostPreservation = preservedText / crossedText;
      const report = { theme, material, color, dpr: state.dpr, size: dom.getSize(), referenceInk, rasterInk, pixiInk, inkIou, pixiIou, crossedText, ghostPreservation, measuredHeights: state.measuredHeights, authored };
      reports.push(report);
      await writeFile(path.join(output, `${theme}-${material}-${color}-dom.png`), dom.toPNG());
      await writeFile(path.join(output, `${theme}-${material}-${color}-raster.png`), raster.toPNG());
      await writeFile(path.join(output, `${theme}-${material}-${color}-pixi.png`), pixi.toPNG());
      if (referenceInk < 100 || rasterInk < 100 || pixiInk < 100 || inkIou < 0.95 || pixiIou < 0.95 || crossedText < 10 || ghostPreservation < 0.95
        || Math.min(authored.dom, authored.raster, authored.pixi) < 10) throw new Error(`visual_content_mismatch:${JSON.stringify(report)}`);
    }
    const line = z.object({ dpr: z.number(), image: z.string() }).parse(await win.webContents.executeJavaScript('window.prepareCanvasLineVisualProbe()'));
    const lineImage = nativeImage.createFromDataURL(line.image), linePixels = lineImage.toBitmap(), lineWidth = lineImage.getSize().width;
    let dashInk = 0, dashGap = 0;
    for (let x = Math.ceil(80 * line.dpr); x < Math.floor(250 * line.dpr); x++) {
      const i = (Math.floor(350 * line.dpr) * lineWidth + x) * 4;
      if (linePixels[i] < 230 && linePixels[i + 1] < 230 && linePixels[i + 2] < 230) dashInk++; else dashGap++;
    }
    await writeFile(path.join(output, 'lines.png'), lineImage.toPNG());
    if (dashInk < 30 || dashGap < 30) throw new Error(`line_dash_is_not_rendered:${dashInk}:${dashGap}`);
    const map = z.object({ before: z.string(), after: z.string(), dpr: z.number(), dx: z.number(), dy: z.number() }).parse(await win.webContents.executeJavaScript('window.prepareCanvasMapPanVisualProbe()'));
    const mapBefore = nativeImage.createFromDataURL(map.before), mapAfter = nativeImage.createFromDataURL(map.after);
    const beforePixels = mapBefore.toBitmap(), afterPixels = mapAfter.toBitmap(), mapSize = mapBefore.getSize();
    let mapInk = 0, mapPreserved = 0;
    for (let y = 0; y < mapSize.height - map.dy * map.dpr; y++) for (let x = 0; x < mapSize.width - map.dx * map.dpr; x++) {
      const a = (y * mapSize.width + x) * 4, b = ((y + map.dy * map.dpr) * mapSize.width + x + map.dx * map.dpr) * 4;
      if (beforePixels[a] < 150 && beforePixels[a + 1] < 150 && beforePixels[a + 2] < 150) {
        mapInk++; if (afterPixels[b] < 150 && afterPixels[b + 1] < 150 && afterPixels[b + 2] < 150) mapPreserved++;
      }
    }
    if (mapInk < 100 || mapPreserved / mapInk < 0.95) throw new Error(`map_pan_labels_mismatch:${mapInk}:${mapPreserved}`);
    await writeFile(path.join(output, 'map-before.png'), mapBefore.toPNG()); await writeFile(path.join(output, 'map-after.png'), mapAfter.toPNG());
    const thumbnails = z.object({ titles: z.string(), thumbnails: z.string(), dpr: z.number() }).parse(await win.webContents.executeJavaScript('window.prepareCanvasThumbnailVisualProbe()'));
    const thumbReports = [];
    for (const mode of ['titles', 'thumbnails'] as const) {
      const image = nativeImage.createFromDataURL(thumbnails[mode]), pixels = image.toBitmap(), size = image.getSize();
      const counts = [100, 250, 400].map(left => {
        let count = 0;
        for (let y = 100 * thumbnails.dpr; y < 160 * thumbnails.dpr; y++) for (let x = left * thumbnails.dpr; x < (left + 100) * thumbnails.dpr; x++) {
          const index = (y * size.width + x) * 4;
          if (pixels[index + 2] > 170 && pixels[index + 1] < 160 && pixels[index] > 160) count++;
        }
        return count;
      });
      if (counts[0] < 500 || counts[1] < 500 || (mode === 'titles' ? counts[2] !== 0 : counts[2] < 500)) throw new Error(`far_thumbnail_semantics_mismatch:${mode}:${counts}`);
      thumbReports.push({ mode, counts }); await writeFile(path.join(output, `thumbnail-${mode}.png`), image.toPNG());
    }
    const context = z.object({ before: z.string(), after: z.string(), rejected: z.boolean(), beforeStats: z.object({ cards: z.number(), bitmaps: z.number() }), afterStats: z.object({ cards: z.number(), bitmaps: z.number() }) })
      .parse(await win.webContents.executeJavaScript('window.prepareCanvasContextLossVisualProbe()'));
    const contextBefore = nativeImage.createFromDataURL(context.before).toBitmap(), contextAfterImage = nativeImage.createFromDataURL(context.after), contextAfter = contextAfterImage.toBitmap();
    let contextInk = 0, contextPreserved = 0;
    for (let index = 0; index < contextBefore.length; index += 4) if (contextBefore[index] < 180 && contextBefore[index + 1] < 180 && contextBefore[index + 2] < 180) {
      contextInk++; if (contextAfter[index] < 180 && contextAfter[index + 1] < 180 && contextAfter[index + 2] < 180) contextPreserved++;
    }
    if (contextInk < 100 || contextPreserved / contextInk < 0.95 || context.afterStats.cards !== context.beforeStats.cards || context.afterStats.bitmaps !== context.beforeStats.bitmaps) throw new Error('context_restore_content_missing');
    await writeFile(path.join(output, 'context-restored.png'), contextAfterImage.toPNG());
    const unsupported = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false, disableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
    let fallbackInk = 0;
    try {
      await unsupported.loadFile(path.join(output, 'index.html'));
      const fallback = z.object({ image: z.string(), errors: z.array(z.string()) }).parse(await unsupported.webContents.executeJavaScript('window.prepareCanvasUnsupportedApiVisualProbe()'));
      const fallbackImage = nativeImage.createFromDataURL(fallback.image), pixels = fallbackImage.toBitmap();
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 150 && pixels[index + 1] < 150 && pixels[index + 2] < 150) fallbackInk++;
      if (fallbackInk < 100) throw new Error('unsupported_api_identity_is_empty');
      await writeFile(path.join(output, 'api-unavailable-identity.png'), fallbackImage.toPNG());
    } finally { unsupported.destroy(); }
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ versions: process.versions, reports, lines: { dashInk, dashGap }, map: { mapInk, mapPreserved, ratio: mapPreserved / mapInk }, thumbnails: thumbReports,
      contextLoss: { rejected: context.rejected, contextInk, contextPreserved, ratio: contextPreserved / contextInk, before: context.beforeStats, after: context.afterStats }, apiFallback: { fallbackInk } }, null, 2));
    console.log(JSON.stringify(reports, null, 2));
  } finally { win.destroy(); }
}
void mkdir(output, { recursive: true }).then(run).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
