import { app, BrowserWindow, powerMonitor, screen } from 'electron';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';
import { z } from 'zod';

const output = process.argv[2];
if (!output) throw new Error('Performance output directory required');
app.setPath('userData', path.join(output, 'profile'));
const softwareProfile = process.env.CANVAS_PERFORMANCE_SOFTWARE === '1';
const offscreenProfile = softwareProfile || process.env.CANVAS_PERFORMANCE_OFFSCREEN === '1';
if (softwareProfile) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.on('window-all-closed', () => {});
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function run() {
  await app.whenReady();
  const unlocked = (state: string) => state === 'active' || state === 'idle';
  const idleBefore = powerMonitor.getSystemIdleState(1), thermalBefore = powerMonitor.getCurrentThermalState();
  if (!offscreenProfile && !unlocked(idleBefore)) throw new Error(`Native benchmark requires a verified unlocked desktop: ${idleBefore}`);
  if (offscreenProfile && process.platform === 'darwin') app.setActivationPolicy('accessory');
  const lockEvents: { readonly event: string; readonly time: string }[] = [];
  powerMonitor.on('lock-screen', () => lockEvents.push({ event: 'lock', time: new Date().toISOString() }));
  powerMonitor.on('unlock-screen', () => lockEvents.push({ event: 'unlock', time: new Date().toISOString() }));
  const startedAt = new Date().toISOString();
  const win = new BrowserWindow({ show: !offscreenProfile, width: 1600, height: 968, useContentSize: true, title: 'Canvas native performance probe', webPreferences: { sandbox: true, contextIsolation: true, offscreen: offscreenProfile,
    backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  try {
    await win.loadFile(path.join(output, 'index.html'));
    const reports = [];
    const counts = process.env.CANVAS_PERFORMANCE_COUNTS?.split(',').map(Number) ?? [250, 2500, 12000];
    for (const count of counts) for (const clustered of [false, true]) {
      console.log(`Canvas formal body performance ${count} ${clustered ? 'clustered' : 'uniform'}`);
      const initial: unknown = await win.webContents.executeJavaScript(`window.prepareCanvasPerformanceProbe(${count},${clustered})`);
      if (softwareProfile) {
        const reduced = z.object({ resolution: z.number(), renderStatus: z.object({ limited: z.boolean(), message: z.string().nullable() }) }).parse(initial);
        if (!reduced.renderStatus.limited || !reduced.renderStatus.message || reduced.resolution > 1) throw new Error('software_gpu_did_not_reduce_rendering');
      }
      await delay(100);
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 800, y: 480, button: 'middle', clickCount: 1 });
      for (let i = 0; i < 50; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: 800 + i * 3, y: 480 + i }); await delay(20); }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 947, y: 529, button: 'middle', clickCount: 1 });
      const pan: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      const close: unknown = await win.webContents.executeJavaScript('window.closeCanvasPerformanceView()');
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      const bodySettled: unknown = await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
      const bodyLoad: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      await writeFile(path.join(output, `${count}-${clustered ? 'cluster' : 'uniform'}.png`), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      for (let i = 0; i < 100; i++) { win.webContents.sendInputEvent({ type: 'mouseWheel', x: 800, y: 480,
        deltaY: i < 50 ? -5 : 5, deltaX: 0, modifiers: ['control'], canScroll: true }); await delay(20); }
      const zoom: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      const zoomSettled: unknown = await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
      let drag: unknown;
      if (process.env.CANVAS_PERFORMANCE_DRAG === '1') {
        const target = z.object({ point: z.object({ x: z.number(), y: z.number() }), selected: z.number(), cardId: z.string() }).parse(await win.webContents.executeJavaScript('window.prepareCanvasPerformanceDrag(500)'));
        await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
        win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(target.point.x), y: Math.round(target.point.y), button: 'left', clickCount: 1 });
        for (let i = 0; i < 50; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(target.point.x + i * 2), y: Math.round(target.point.y + i) }); await delay(20); }
        win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(target.point.x + 98), y: Math.round(target.point.y + 49), button: 'left', clickCount: 1 });
        const frames: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
        const intents = z.object({ movedCards: z.number(), selected: z.number() }).parse(await win.webContents.executeJavaScript('window.finishCanvasPerformanceDrag()'));
        if (intents.movedCards !== target.selected) throw new Error(`native_drag_did_not_finish:${intents.movedCards}:${target.selected}`);
        drag = { target, frames, intents };
      }
      const report = { count, clustered, initial, pan, close, bodyLoad, bodySettled, zoom, zoomSettled, drag };
      reports.push(report); console.log(JSON.stringify(report));
    }
    const idleAfter = powerMonitor.getSystemIdleState(1), display = screen.getDisplayMatching(win.getBounds());
    const validDesktopRun = unlocked(idleAfter) && !lockEvents.some(event => event.event === 'lock');
    const validHardwareRun = !offscreenProfile && validDesktopRun;
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ fixtureVersion: 'production-dom-v3', source: { commit: process.env.CANVAS_PROBE_SOURCE_COMMIT, dirty: process.env.CANVAS_PROBE_SOURCE_DIRTY === '1' }, startedAt, endedAt: new Date().toISOString(),
      renderingProfile: softwareProfile ? 'offscreen-swiftshader' : offscreenProfile ? 'offscreen-counts' : 'visible-hardware',
      versions: process.versions, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model,
      idleBefore, idleAfter, lockEvents, validHardwareRun, thermalBefore, thermalAfter: powerMonitor.getCurrentThermalState(),
      display: { label: display.label, internal: display.internal, scaleFactor: display.scaleFactor, displayFrequency: display.displayFrequency, bounds: display.bounds },
      gpu: await app.getGPUInfo('basic'), reports }, null, 2));
    if (!offscreenProfile && !validDesktopRun) throw new Error('Desktop locked during native performance benchmark');
  } finally { win.destroy(); }
}
void mkdir(output, { recursive: true }).then(run).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
