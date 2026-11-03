import { app, BrowserWindow, nativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

const rectangle = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const prepared = z.object({ viewportWidth: z.number(), viewportHeight: z.number(), dpr: z.number(), reference: rectangle, raster: rectangle, pixi: rectangle, ghostY: z.number() });
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
    for (const theme of ['light', 'dark']) for (const material of ['paper', 'card']) {
      const state = prepared.parse(await win.webContents.executeJavaScript(`window.prepareCanvasVisualProbe(${JSON.stringify(theme)},${JSON.stringify(material)})`));
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
      for (let i = 0; i < a.length; i += 4) {
        const aa = ink(a, i); const bb = ink(b, i); const cc = ink(c, i);
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
      const report = { theme, material, dpr: state.dpr, size: dom.getSize(), referenceInk, rasterInk, pixiInk, inkIou, pixiIou, crossedText, ghostPreservation };
      reports.push(report);
      await writeFile(path.join(output, `${theme}-${material}-dom.png`), dom.toPNG());
      await writeFile(path.join(output, `${theme}-${material}-raster.png`), raster.toPNG());
      await writeFile(path.join(output, `${theme}-${material}-pixi.png`), pixi.toPNG());
      if (referenceInk < 100 || rasterInk < 100 || pixiInk < 100 || inkIou < 0.95 || pixiIou < 0.95 || crossedText < 10 || ghostPreservation < 0.95) throw new Error(`visual_content_mismatch:${JSON.stringify(report)}`);
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
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ versions: process.versions, reports, lines: { dashInk, dashGap } }, null, 2));
    console.log(JSON.stringify(reports, null, 2));
  } finally { win.destroy(); }
}
void mkdir(output, { recursive: true }).then(run).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
