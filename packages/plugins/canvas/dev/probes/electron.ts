import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

interface ProbeResult {
  readonly mode: string;
  readonly measured: boolean;
  readonly drawn: boolean;
  readonly details: unknown;
}

const output = process.argv[2];
if (!output) throw new Error('Probe output directory is required');
app.setPath('userData', path.join(output, 'profile'));
const results: ProbeResult[] = [];
// 探针逐个销毁自己的窗口，生命周期由报告完成决定。
app.on('window-all-closed', () => {});

async function probe(mode: 'hidden' | 'offscreen'): Promise<void> {
  const win = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES,
      offscreen: mode === 'offscreen',
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    await win.loadFile(path.join(output, 'index.html'));
    const result: unknown = await win.webContents.executeJavaScript('window.runCanvasProbe()');
    const measured = typeof result === 'object' && result !== null && Reflect.get(result, 'measurementPassed') === true;
    const drawn = typeof result === 'object' && result !== null && Reflect.get(result, 'drawingPassed') === true;
    results.push({ mode, measured, drawn, details: result });
  } catch (error) {
    results.push({ mode, measured: false, drawn: false, details: String(error) });
  } finally {
    win.destroy();
  }
}

void app.whenReady().then(async () => {
  try {
    await probe('hidden');
    await probe('offscreen');
    const report = { environment: { versions: process.versions, platform: process.platform, arch: process.arch }, results };
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(results.some((r) => r.measured && r.drawn) ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
