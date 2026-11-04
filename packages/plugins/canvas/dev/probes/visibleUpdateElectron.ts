import { app, BrowserWindow, nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';
import { z } from 'zod';
import { startCanvasPhaseTrace } from './canvasPhaseTrace';
import { startCanvasPaintTrace } from './performancePaintTraceElectron';

const output = process.argv[2]; if (!output) throw new Error('Visible-update output required');
app.setPath('userData', path.join(output, 'profile')); app.on('window-all-closed', () => {});
const change = z.enum(['color', 'text']).parse(process.env.CANVAS_VISIBLE_UPDATE_CHANGE ?? 'color');
const selectedCase = z.enum(['unpolled', 'polled', 'animated', 'polled-animated']).optional().parse(process.env.CANVAS_VISIBLE_UPDATE_CASE ?? (change === 'text' ? 'polled-animated' : undefined));
async function run() {
  await app.whenReady(); if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const win = new BrowserWindow({ show: false, width: 2800, height: 1800, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, zoomFactor: 2, backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  try {
    win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
    await win.loadFile(path.join(output, 'index.html'));
    const initial: unknown = await win.webContents.executeJavaScript(`window.prepareVisibleUpdateProbe(${JSON.stringify(change)})`);
    const reports: unknown[] = [];
    const cases = selectedCase ? [selectedCase] : ['unpolled', 'polled', 'animated'];
    for (const name of cases) {
      const poll = name === 'polled' || name === 'polled-animated', animate = name === 'animated' || name === 'polled-animated';
      const tracing = process.env.CANVAS_VISIBLE_UPDATE_TRACE === '1';
      // Chromium trace已包含CPU ProfileChunks，不能同时再启一份Profiler干扰采样。
      const profile = process.env.CANVAS_VISIBLE_UPDATE_PROFILE === '1' && !tracing;
      const stopTrace = tracing ? await startCanvasPhaseTrace({ output, stem: `update-${name}`, phase: 'visible-update',
        start: () => win.webContents.executeJavaScript('window.startVisibleUpdateTrace()'), finish: () => win.webContents.executeJavaScript('window.finishVisibleUpdateTrace()') }) : null;
      let stopPaint: (() => Promise<void>) | null = null;
      try {
        if (process.env.CANVAS_PERFORMANCE_PAINT_TRACE === '1') stopPaint = await startCanvasPaintTrace(win.webContents, output, `update-${name}`);
        if (profile) { win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); }
        reports.push(await win.webContents.executeJavaScript(`window.updateVisibleUpdateProbe(${poll},${animate})`));
      } finally {
        try {
          if (profile) { const data: unknown = await win.webContents.debugger.sendCommand('Profiler.stop'); await writeFile(path.join(output, `update-${name}.cpuprofile`), JSON.stringify(data)); win.webContents.debugger.detach(); }
        } finally { try { await stopPaint?.(); } finally { await stopTrace?.(); } }
      }
      const image = z.string().parse(await win.webContents.executeJavaScript('window.captureVisibleUpdateProbe()'));
      await writeFile(path.join(output, `update-${name}.png`), nativeImage.createFromDataURL(image).toPNG());
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ sourceCommit: process.env.CANVAS_PROBE_SOURCE_COMMIT,
      sourceDirty: process.env.CANVAS_PROBE_SOURCE_DIRTY === '1', rendererTree: process.env.CANVAS_PROBE_RENDERER_TREE,
      versions: process.versions, profile: 'offscreen-diagnostic', diagnostic: 'isolated-renderer-body-update', validHardwareRun: false,
      profiling: process.env.CANVAS_VISIBLE_UPDATE_PROFILE === '1' || process.env.CANVAS_VISIBLE_UPDATE_TRACE === '1' || process.env.CANVAS_PERFORMANCE_PAINT_TRACE === '1',
      change, selectedCase, cpuProfileSource: process.env.CANVAS_VISIBLE_UPDATE_TRACE === '1' ? 'ChromiumProfileChunks' : process.env.CANVAS_VISIBLE_UPDATE_PROFILE === '1' ? 'Profiler' : 'none', initial, reports }, null, 2));
    console.log(JSON.stringify(reports));
  } finally { win.destroy(); }
}
void run().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
