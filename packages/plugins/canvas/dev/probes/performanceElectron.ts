import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

const output = process.argv[2];
if (!output) throw new Error('Performance output directory required');
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ show: true, width: 1600, height: 968, webPreferences: { sandbox: true, contextIsolation: true,
    backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  try {
    await win.loadFile(path.join(output, 'index.html'));
    const reports = [];
    const counts = process.env.CANVAS_PERFORMANCE_COUNTS?.split(',').map(Number) ?? [250, 2500, 12000];
    for (const count of counts) for (const clustered of [false, true]) {
      console.log(`Canvas formal body performance ${count} ${clustered ? 'clustered' : 'uniform'}`);
      const initial: unknown = await win.webContents.executeJavaScript(`window.prepareCanvasPerformanceProbe(${count},${clustered})`);
      await delay(100);
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 800, y: 480, button: 'middle', clickCount: 1 });
      for (let i = 0; i < 50; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: 800 + i * 3, y: 480 + i }); await delay(20); }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 947, y: 529, button: 'middle', clickCount: 1 });
      const pan: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      const close: unknown = await win.webContents.executeJavaScript('window.closeCanvasPerformanceView()');
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      await delay(1500);
      const bodyLoad: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      for (let i = 0; i < 100; i++) { win.webContents.sendInputEvent({ type: 'mouseWheel', x: 800, y: 480,
        deltaY: i < 50 ? -5 : 5, deltaX: 0, modifiers: ['control'], canScroll: true }); await delay(20); }
      const zoom: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      const report = { count, clustered, initial, pan, close, bodyLoad, zoom };
      reports.push(report); console.log(JSON.stringify(report));
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ versions: process.versions, platform: process.platform,
      arch: process.arch, gpu: await app.getGPUInfo('basic'), reports }, null, 2));
  } finally { win.destroy(); }
}
void mkdir(output, { recursive: true }).then(run).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
