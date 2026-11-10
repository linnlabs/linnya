import { app, BrowserWindow, nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readNativeSessionState } from './readNativeSessionState';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

const output = process.argv[2]; if (!output) throw new Error('Visibility output required');
app.setPath('userData', path.join(output, 'profile')); app.on('window-all-closed', () => {});
const stateSchema = z.object({ visibility: z.enum(['hidden', 'visible']), revision: z.number(), failures: z.array(z.string()),
  queue: z.object({ pending: z.number(), running: z.boolean(), failed: z.number() }), scene: z.object({ bitmaps: z.number() }) });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function run() {
  await app.whenReady(); if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const sessionBefore = readNativeSessionState();
  await writeFile(path.join(output, 'preflight.json'), JSON.stringify({ time: new Date().toISOString(), sessionBefore, accepted: process.platform !== 'darwin' || sessionBefore?.unlocked === true }, null, 2));
  if (process.platform === 'darwin' && !sessionBefore?.unlocked) throw new Error('Visibility test requires an unlocked console; no window was opened');
  const window = new BrowserWindow({ show: false, width: 900, height: 600, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: true, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  const read = async () => stateSchema.parse(await window.webContents.executeJavaScript('window.readCanvasVisibilityProbe()'));
  try {
    await window.loadFile(path.join(output, 'index.html')); window.showInactive();
    const initial = stateSchema.parse(await window.webContents.executeJavaScript('window.prepareCanvasVisibilityProbe()'));
    if (initial.visibility !== 'visible') throw new Error('visibility_window_not_visible');
    window.hide();
    const started = performance.now(); let hidden = await read();
    while (hidden.visibility !== 'hidden' && performance.now() - started < 3000) { await delay(20); hidden = await read(); }
    if (hidden.visibility !== 'hidden') throw new Error('native_hide_did_not_hide_document');
    await window.webContents.executeJavaScript('window.changeHiddenCanvasVisibilityProbe()');
    await delay(2200); const afterHidden = await read();
    if (afterHidden.queue.pending || afterHidden.queue.running || afterHidden.queue.failed || afterHidden.failures.length) throw new Error('hidden_surface_did_not_suspend_raster');
    window.showInactive();
    const restored = stateSchema.parse(await window.webContents.executeJavaScript('window.settleCanvasVisibilityProbe()'));
    if (restored.revision !== 2 || restored.visibility !== 'visible') throw new Error('visibility_resume_did_not_use_latest_content');
    const actual = nativeImage.createFromDataURL(await window.webContents.executeJavaScript('window.captureCanvasVisibilityProbe()'));
    const expected = nativeImage.createFromDataURL(await window.webContents.executeJavaScript('window.freshCanvasVisibilityProbe()'));
    const a = actual.toBitmap(), b = expected.toBitmap(); let ink = 0, intersection = 0, union = 0;
    if (a.length !== b.length) throw new Error('visibility_capture_dimensions_changed');
    for (let i = 0; i < a.length; i += 4) {
      const left = a[i] < 150 && a[i + 1] < 150 && a[i + 2] < 150, right = b[i] < 150 && b[i + 1] < 150 && b[i + 2] < 150;
      if (right) ink++; if (left && right) intersection++; if (left || right) union++;
    }
    if (ink < 100 || intersection / union < 0.99) throw new Error('visibility_resume_pixels_are_stale');
    const sessionAfter = readNativeSessionState(); if (process.platform === 'darwin' && !sessionAfter?.unlocked) throw new Error('Console locked during visibility test');
    await writeFile(path.join(output, 'restored.png'), actual.toPNG()); await writeFile(path.join(output, 'reference.png'), expected.toPNG());
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ source: process.env.CANVAS_PROBE_SOURCE_COMMIT, sessionBefore, sessionAfter,
      versions: process.versions, initial, hidden, afterHidden, restored, ink, ratio: intersection / union, passed: true }, null, 2));
  } finally { window.destroy(); }
}
void run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
