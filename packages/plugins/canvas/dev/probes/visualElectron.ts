import { verifySceneVisual } from './sceneVisualElectron';
import { readCanvasLinePalette } from '../../src/shared';
import { app, BrowserWindow, nativeImage, type WebContents, type Event, type RenderProcessGoneDetails } from 'electron';
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

async function evaluate(webContents: WebContents, expression: string): Promise<unknown> {
  console.log(`[canvas visual] ${expression}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeCrashListener = () => {};
  try {
    return await Promise.race([webContents.executeJavaScript(expression), new Promise<never>((_, reject) => {
      const gone = (_event: Event, details: RenderProcessGoneDetails) => reject(new Error(`visual_renderer_gone:${details.reason}:${details.exitCode}:${expression}`));
      webContents.once('render-process-gone', gone); removeCrashListener = () => { webContents.removeListener('render-process-gone', gone); };
      timer = setTimeout(() => reject(new Error(`visual_case_timeout:${expression}`)), 45000);
    })]);
  } finally { clearTimeout(timer); removeCrashListener(); }
}

const fadeState = z.object({ image: z.string(), dpr: z.number(), elapsed: z.number(), oldWidth: z.number(), blueWidth: z.number(), greenWidth: z.number(),
  rendered: z.boolean(), reduced: z.boolean(), stats: z.object({ fadingCards: z.number(), retiringBytes: z.number(), bitmapBytes: z.number(), bitmapBudgetBytes: z.number() }) });
async function verifyFade(win: BrowserWindow) {
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const initial = fadeState.extend({ before: z.string() }).parse(await evaluate(win.webContents, 'window.beginCanvasFadeVisualProbe()'));
    if (initial.stats.fadingCards !== 1 || initial.rendered || initial.oldWidth !== 50 || initial.stats.bitmapBytes !== 35000) throw new Error('real_texture_fade_did_not_start');
    await new Promise(resolve => setTimeout(resolve, 40));
    const middle = fadeState.parse(await evaluate(win.webContents, 'window.readCanvasFadeVisualProbe()'));
    const pixel = (url: string, dpr: number) => {
      const image = nativeImage.createFromDataURL(url), bytes = image.toBitmap(), i = (Math.round(80 * dpr) * image.getSize().width + Math.round(100 * dpr)) * 4;
      return { r: bytes[i + 2], g: bytes[i + 1], b: bytes[i] };
    };
    const mixed = pixel(middle.image, middle.dpr), midpointObserved = middle.stats.fadingCards > 0;
    if (midpointObserved && (mixed.r < 50 || mixed.b < 60)) throw new Error(`fade_midpoint_pixels_missing:${JSON.stringify(mixed)}`);
    await evaluate(win.webContents, 'window.replaceCanvasFadeVisualProbe()');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = fadeState.parse(await evaluate(win.webContents, 'window.finishCanvasFadePreferenceVisualProbe()'));
    const green = pixel(reduced.image, reduced.dpr);
    if (!reduced.reduced || reduced.stats.fadingCards || reduced.stats.retiringBytes || !reduced.rendered || reduced.oldWidth || reduced.blueWidth
      || reduced.greenWidth !== 150 || reduced.stats.bitmapBytes !== 63000 || green.g < 190 || green.r > 45) throw new Error('reduced_motion_did_not_finish_actual_texture_fade');
    if (Math.max(initial.stats.bitmapBytes, middle.stats.bitmapBytes, reduced.stats.bitmapBytes) > initial.stats.bitmapBudgetBytes) throw new Error('fade_exceeded_bitmap_budget');
    await writeFile(path.join(output, 'fade-midpoint.png'), nativeImage.createFromDataURL(middle.image).toPNG());
    await writeFile(path.join(output, 'fade-reduced.png'), nativeImage.createFromDataURL(reduced.image).toPNG());
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const budget: unknown = await evaluate(win.webContents, 'window.prepareCanvasFadeBudgetVisualProbe()');
    return { midpointObserved, mixed, green, oldAndNewBytes: initial.stats.bitmapBytes, reducedBytes: reduced.stats.bitmapBytes, reducedRendered: reduced.rendered, budget };
  } finally { await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); win.webContents.debugger.detach(); }
}

async function run() {
  await app.whenReady();
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const win = new BrowserWindow({ show: false, width: 2400, height: 1200, webPreferences: { sandbox: true, contextIsolation: true,
    offscreen: true, backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  win.webContents.on('console-message', details => { if (details.level === 'error' || details.level === 'warning' || details.message.startsWith('[canvas visual')) console.error(details.message); });
  win.webContents.on('render-process-gone', (_event, details) => console.error('[canvas visual renderer gone]', details));
  try {
    await win.loadFile(path.join(output, 'index.html'));
    win.webContents.setZoomFactor(2);
    const reports = [];
    for (const theme of ['light', 'dark']) for (const material of ['paper', 'card']) for (const color of material === 'paper' ? ['white', 'red', 'green'] : ['white']) {
      const state = prepared.parse(await evaluate(win.webContents, `window.prepareCanvasVisualProbe(${JSON.stringify(theme)},${JSON.stringify(material)},${JSON.stringify(color)})`));
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
    const line = z.object({ dpr: z.number(), image: z.string(), half: z.string() }).parse(await evaluate(win.webContents, 'window.prepareCanvasLineVisualProbe()'));
    const lineImage = nativeImage.createFromDataURL(line.image), linePixels = lineImage.toBitmap(), lineWidth = lineImage.getSize().width;
    let dashInk = 0, dashGap = 0;
    for (let x = Math.ceil(80 * line.dpr); x < Math.floor(250 * line.dpr); x++) {
      const i = (Math.floor(350 * line.dpr) * lineWidth + x) * 4;
      if (linePixels[i] < 230 && linePixels[i + 1] < 230 && linePixels[i + 2] < 230) dashInk++; else dashGap++;
    }
    let dashRepeated = 0, dashSamples = 0;
    for (let x = 80 * line.dpr; x < 250 * line.dpr; x++) {
      const a = (Math.floor(350 * line.dpr) * lineWidth + x) * 4, b = a + 9 * line.dpr * 4;
      if ((linePixels[a] < 230) === (linePixels[b] < 230)) dashRepeated++; dashSamples++;
    }
    if (dashRepeated / dashSamples < 0.99) throw new Error(`dash_screen_period_not_nine:${dashRepeated}:${dashSamples}`);
    const looseEndpoints = [1, 0.5].map(zoom => {
      const image = nativeImage.createFromDataURL(zoom === 1 ? line.image : line.half), pixels = image.toBitmap(), size = image.getSize();
      const sample = (x: number, y: number) => { const i = (Math.round(y * line.dpr) * size.width + Math.round(x * line.dpr)) * 4; return [pixels[i + 2], pixels[i + 1], pixels[i]]; };
      const center = sample(100 * zoom, 450 * zoom), rim = sample(100 * zoom + 3, 450 * zoom), arrow = sample(499 * zoom, 500 * zoom);
      if (Math.max(...center) - Math.min(...center) > 8 || rim[1] >= center[1] - 8 || arrow[1] >= center[1] - 8) throw new Error(`loose_endpoint_hollow_or_screen_radius_missing:${zoom}:${center}:${rim}:${arrow}`);
      return { zoom, center, rim, arrow };
    });
    await writeFile(path.join(output, 'lines.png'), lineImage.toPNG());
    if (dashInk < 30 || dashGap < 30) throw new Error(`line_dash_is_not_rendered:${dashInk}:${dashGap}`);
    const coloredLines = z.object({ light: z.string(), dark: z.string(), dpr: z.number(), colors: z.array(z.enum(['red', 'orange', 'yellow', 'green', 'cyan', 'purple'])) })
      .parse(await evaluate(win.webContents, 'window.prepareCanvasLineColorsVisualProbe()'));
    const colorReports = [];
    for (const theme of ['light', 'dark'] as const) {
      const image = nativeImage.createFromDataURL(coloredLines[theme]), pixels = image.toBitmap(), width = image.getSize().width, palette = readCanvasLinePalette(theme === 'dark');
      for (const [index, color] of coloredLines.colors.entries()) {
        const expected = palette[color], r = expected >> 16 & 255, g = expected >> 8 & 255, b = expected & 255;
        let matching = 0;
        for (let x = 80 * coloredLines.dpr; x < 800 * coloredLines.dpr; x++) for (let y = (59 + index * 70) * coloredLines.dpr; y <= (61 + index * 70) * coloredLines.dpr; y++) {
          const offset = (y * width + x) * 4;
          if (Math.abs(pixels[offset] - b) <= 4 && Math.abs(pixels[offset + 1] - g) <= 4 && Math.abs(pixels[offset + 2] - r) <= 4) matching++;
        }
        if (matching < 500) throw new Error(`edge_color_missing:${theme}:${color}:${matching}`);
        colorReports.push({ theme, color, matching });
      }
      await writeFile(path.join(output, `lines-colors-${theme}.png`), image.toPNG());
    }
    const occlusion = z.object({ before: z.string(), during: z.string(), after: z.string(), dpr: z.number() })
      .parse(await evaluate(win.webContents, 'window.prepareCanvasDragOcclusionVisualProbe()'));
    const magenta = (data: string) => {
      const image = nativeImage.createFromDataURL(data), pixels = image.toBitmap(), width = image.getSize().width; let count = 0;
      for (let y = 80 * occlusion.dpr; y < 200 * occlusion.dpr; y++) for (let x = 70 * occlusion.dpr; x < 300 * occlusion.dpr; x++) {
        const offset = (y * width + x) * 4; if (pixels[offset + 2] > 170 && pixels[offset + 1] < 40 && pixels[offset] > 150) count++;
      }
      return count;
    };
    const dragOcclusion = { before: magenta(occlusion.before), during: magenta(occlusion.during), after: magenta(occlusion.after) };
    if (dragOcclusion.before || dragOcclusion.after || dragOcclusion.during < 1000) throw new Error(`drag_occlusion_stale:${JSON.stringify(dragOcclusion)}`);
    await writeFile(path.join(output, 'drag-revealed-body.png'), nativeImage.createFromDataURL(occlusion.during).toPNG());
    const guides = z.object({ shown: z.string(), hidden: z.string() }).parse(await evaluate(win.webContents, 'window.prepareCanvasGuidesVisualProbe()'));
    const greenPixels = (url: string) => {
      const pixels = nativeImage.createFromDataURL(url).toBitmap(); let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > pixels[i + 2] + 20 && pixels[i + 1] > pixels[i] + 20) count++;
      return count;
    };
    const snapGuides = { shown: greenPixels(guides.shown), hidden: greenPixels(guides.hidden) };
    if (snapGuides.shown < 1000 || snapGuides.hidden !== 0) throw new Error(`snap_guides_not_projected_or_cleared:${JSON.stringify(snapGuides)}`);
    const map = z.object({ before: z.string(), after: z.string(), dpr: z.number(), dx: z.number(), dy: z.number() }).parse(await evaluate(win.webContents, 'window.prepareCanvasMapPanVisualProbe()'));
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
    const selectedMap = z.object({ before: z.string(), selected: z.string(), reference: z.string() })
      .parse(await evaluate(win.webContents, 'window.prepareCanvasSelectedMapVisualProbe()'));
    const beforeMap = nativeImage.createFromDataURL(selectedMap.before).toBitmap(), chosenMap = nativeImage.createFromDataURL(selectedMap.selected).toBitmap();
    const expectedMap = nativeImage.createFromDataURL(selectedMap.reference).toBitmap(); let selectedInk = 0, selectedIntersection = 0, selectedUnion = 0, selectionChanges = 0;
    for (let i = 0; i < expectedMap.length; i += 4) {
      const ink = (pixels: Uint8Array) => pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150;
      const expected = ink(expectedMap), actual = ink(chosenMap);
      if (expected) selectedInk++; if (expected && actual) selectedIntersection++; if (expected || actual) selectedUnion++;
      if (actual !== ink(beforeMap)) selectionChanges++;
    }
    const selectedLabels = { selectedInk, selectionChanges, ratio: selectedIntersection / selectedUnion };
    if (selectedInk < 100 || selectionChanges < 100 || selectedLabels.ratio < 0.99) throw new Error(`selected_map_priority_missing:${JSON.stringify(selectedLabels)}`);
    const thumbnails = z.object({ titles: z.string(), thumbnails: z.string(), dpr: z.number() }).parse(await evaluate(win.webContents, 'window.prepareCanvasThumbnailVisualProbe()'));
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
    const lodReports = [];
    for (const theme of ['light', 'dark']) {
      const lod = z.object({ expected: z.string(), actual: z.string() }).parse(await evaluate(win.webContents, `window.prepareCanvasMixedLodVisualProbe(${JSON.stringify(theme)})`));
      const expected = nativeImage.createFromDataURL(lod.expected), actual = nativeImage.createFromDataURL(lod.actual), a = expected.toBitmap(), b = actual.toBitmap();
      let union = 0, intersection = 0;
      const ink = (pixels: Uint8Array, index: number) => theme === 'light' ? pixels[index] < 180 && pixels[index + 1] < 180 && pixels[index + 2] < 180 : pixels[index] > 150 && pixels[index + 1] > 150 && pixels[index + 2] > 150;
      for (let index = 0; index < a.length; index += 4) { const aa = ink(a, index), bb = ink(b, index); if (aa || bb) union++; if (aa && bb) intersection++; }
      if (union < 100 || intersection / union < 0.95) throw new Error(`mixed_lod_composite_mismatch:${theme}:${intersection / union}`);
      lodReports.push({ theme, union, intersection, ratio: intersection / union }); await writeFile(path.join(output, `mixed-lod-${theme}.png`), actual.toPNG());
    }
    const fade = await verifyFade(win);
    const scene = await verifySceneVisual(win, output, evaluate);
    const context = z.object({ before: z.string(), after: z.string(), rejected: z.boolean(), beforeStats: z.object({ cards: z.number(), bitmaps: z.number() }), afterStats: z.object({ cards: z.number(), bitmaps: z.number() }) })
      .parse(await evaluate(win.webContents, 'window.prepareCanvasContextLossVisualProbe()'));
    const contextBefore = nativeImage.createFromDataURL(context.before).toBitmap(), contextAfterImage = nativeImage.createFromDataURL(context.after), contextAfter = contextAfterImage.toBitmap();
    let contextInk = 0, contextPreserved = 0;
    for (let index = 0; index < contextBefore.length; index += 4) if (contextBefore[index] < 180 && contextBefore[index + 1] < 180 && contextBefore[index + 2] < 180) {
      contextInk++; if (contextAfter[index] < 180 && contextAfter[index + 1] < 180 && contextAfter[index + 2] < 180) contextPreserved++;
    }
    if (contextInk < 100 || contextPreserved / contextInk < 0.95 || context.afterStats.cards !== context.beforeStats.cards || context.afterStats.bitmaps !== context.beforeStats.bitmaps) throw new Error('context_restore_content_missing');
    await writeFile(path.join(output, 'context-restored.png'), contextAfterImage.toPNG());
    const editing = z.object({ expected: z.string(), actual: z.string(), dpr: z.number(), visible: z.number(), status: z.string(), again: z.string(), smoothing: z.string() })
      .parse(await evaluate(win.webContents, 'window.prepareCanvasEditingVisualProbe()'));
    const editingExpected = nativeImage.createFromDataURL(editing.expected), expectedPixels = editingExpected.toBitmap();
    const editingActual = nativeImage.createFromDataURL(editing.actual), actualPixels = editingActual.toBitmap(), editingWidth = editingExpected.getSize().width, actualWidth = editingActual.getSize().width;
    let editingInk = 0, editingIntersection = 0, editingUnion = 0;
    for (let y = 8 * editing.dpr; y < editingWidth - 8 * editing.dpr; y++) for (let x = 8 * editing.dpr; x < editingWidth - 8 * editing.dpr; x++) {
      const a = (y * editingWidth + x) * 4, b = (y * actualWidth + x) * 4;
      const expected = expectedPixels[a] < 180 && expectedPixels[a + 1] < 180 && expectedPixels[a + 2] < 180;
      const actual = actualPixels[b] < 180 && actualPixels[b + 1] < 180 && actualPixels[b + 2] < 180;
      if (expected) editingInk++; if (expected && actual) editingIntersection++; if (expected || actual) editingUnion++;
    }
    await writeFile(path.join(output, 'editing-exact-expected.png'), editingExpected.toPNG());
    await writeFile(path.join(output, 'editing-exact-actual.png'), editingActual.toPNG());
    if (editing.visible <= 40 || editingInk < 10 || editingIntersection / editingUnion < 0.95) throw new Error(`editing_exact_pixels_missing:${editingIntersection}:${editingUnion}`);
    const unsupported = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false, disableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
    let fallbackInk = 0;
    try {
      await unsupported.loadFile(path.join(output, 'index.html'));
      const fallback = z.object({ image: z.string(), errors: z.array(z.string()) }).parse(await evaluate(unsupported.webContents, 'window.prepareCanvasUnsupportedApiVisualProbe()'));
      const fallbackImage = nativeImage.createFromDataURL(fallback.image), pixels = fallbackImage.toBitmap();
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 150 && pixels[index + 1] < 150 && pixels[index + 2] < 150) fallbackInk++;
      if (fallbackInk < 100) throw new Error('unsupported_api_identity_is_empty');
      await writeFile(path.join(output, 'api-unavailable-identity.png'), fallbackImage.toPNG());
    } finally { unsupported.destroy(); }
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ versions: process.versions, reports, lines: { dashInk, dashGap, dashPeriodRatio: dashRepeated / dashSamples, looseEndpoints, colors: colorReports }, dragOcclusion, snapGuides, map: { mapInk, mapPreserved, ratio: mapPreserved / mapInk, selectedLabels }, thumbnails: thumbReports,
      mixedLod: lodReports, fade, scene, editing: { visible: editing.visible, editingInk, ratio: editingIntersection / editingUnion, smoothing: editing.smoothing }, contextLoss: { rejected: context.rejected, contextInk, contextPreserved, ratio: contextPreserved / contextInk, before: context.beforeStats, after: context.afterStats }, apiFallback: { fallbackInk } }, null, 2));
    console.log(JSON.stringify(reports, null, 2));
  } finally { win.destroy(); }
}
void mkdir(output, { recursive: true }).then(run).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
