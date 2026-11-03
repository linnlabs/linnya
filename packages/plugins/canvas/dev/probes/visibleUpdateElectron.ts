import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';

const output = process.argv[2]; if (!output) throw new Error('Visible-update output required');
app.setPath('userData', path.join(output, 'profile')); app.on('window-all-closed', () => {});
async function run() {
  await app.whenReady(); if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  try {
    win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
    await win.loadFile(path.join(output, 'index.html'));
    const initial: unknown = await win.webContents.executeJavaScript('window.prepareVisibleUpdateProbe()');
    const reports: unknown[] = [];
    for (const poll of [false, true]) {
      const profile = process.env.CANVAS_VISIBLE_UPDATE_PROFILE === '1';
      if (profile) { win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); }
      reports.push(await win.webContents.executeJavaScript(`window.updateVisibleUpdateProbe(${poll})`));
      if (profile) { const data: unknown = await win.webContents.debugger.sendCommand('Profiler.stop'); await writeFile(path.join(output, `update-${poll ? 'polled' : 'unpolled'}.cpuprofile`), JSON.stringify(data)); win.webContents.debugger.detach(); }
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ sourceCommit: process.env.CANVAS_PROBE_SOURCE_COMMIT,
      sourceDirty: process.env.CANVAS_PROBE_SOURCE_DIRTY === '1', versions: process.versions, profile: 'offscreen-diagnostic', validHardwareRun: false, initial, reports }, null, 2));
    console.log(JSON.stringify(reports));
  } finally { win.destroy(); }
}
void run().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
