import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

interface ProbeResult {
  readonly mode: string;
  readonly measured: boolean;
  readonly drawn: boolean;
  readonly kernelPassed: boolean;
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
  win.on('page-title-updated', (_event, title) => console.log(`[${mode}] ${title}`));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    await win.loadFile(path.join(output, 'index.html'));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result: unknown = await Promise.race([
      win.webContents.executeJavaScript('window.runCanvasProbe()'),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('probe_timeout')), 30000); }),
    ]).finally(() => clearTimeout(timeout));
    const measured = typeof result === 'object' && result !== null && Reflect.get(result, 'measurementPassed') === true;
    const drawn = typeof result === 'object' && result !== null && Reflect.get(result, 'drawingPassed') === true;
    const kernelPassed = typeof result === 'object' && result !== null && Reflect.get(result, 'kernelPassed') === true;
    results.push({ mode, measured, drawn, kernelPassed, details: result });
  } catch (error) {
    results.push({ mode, measured: false, drawn: false, kernelPassed: false, details: String(error) });
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
    app.exit(results.some((r) => r.measured && r.drawn && r.kernelPassed) ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
