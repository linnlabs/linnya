import { app, BrowserWindow, powerMonitor, screen } from 'electron';
import os from 'node:os';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';
import { z } from 'zod';
import { readNativeSessionState } from './readNativeSessionState';

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
  const nativeSessionBefore = offscreenProfile ? null : readNativeSessionState();
  const requireInternal120 = !offscreenProfile && process.env.CANVAS_PERFORMANCE_INTERNAL_120 === '1';
  const targetDisplay = requireInternal120 ? screen.getAllDisplays().find(display => display.internal && display.displayFrequency >= 119) : undefined;
  const accepted = (offscreenProfile || unlocked(idleBefore) && (process.platform !== 'darwin' || nativeSessionBefore?.unlocked === true))
    && (!requireInternal120 || targetDisplay !== undefined);
  await writeFile(path.join(output, 'preflight.json'), JSON.stringify({ time: new Date().toISOString(), accepted, idleBefore, nativeSessionBefore, requireInternal120,
    targetDisplay: targetDisplay ? { id: targetDisplay.id, internal: targetDisplay.internal, displayFrequency: targetDisplay.displayFrequency, bounds: targetDisplay.bounds } : null }, null, 2));
  if (requireInternal120 && !targetDisplay) throw new Error('Native benchmark requires an active internal 120Hz display');
  if (!accepted) throw new Error('Native benchmark requires an actually unlocked console session');
  await rm(path.join(output, 'results.json'), { force: true });
  if (offscreenProfile && process.platform === 'darwin') app.setActivationPolicy('accessory');
  const lockEvents: { readonly event: string; readonly time: string }[] = [];
  powerMonitor.on('lock-screen', () => lockEvents.push({ event: 'lock', time: new Date().toISOString() }));
  powerMonitor.on('unlock-screen', () => lockEvents.push({ event: 'unlock', time: new Date().toISOString() }));
  const startedAt = new Date().toISOString();
  // 默认primary可能被用户外接屏改变；硬件基线显式钉住自己的120Hz窗口，不改系统显示设置。
  const position = targetDisplay ? { x: targetDisplay.bounds.x + Math.max(0, Math.floor((targetDisplay.bounds.width - 1600) / 2)), y: targetDisplay.bounds.y + 32 } : {};
  const win = new BrowserWindow({ ...position, show: !offscreenProfile, width: 1600, height: 968, useContentSize: true, title: 'Canvas native performance probe', webPreferences: { sandbox: true, contextIsolation: true, offscreen: offscreenProfile,
    backgroundThrottling: false, enableBlinkFeatures: HTML_CANVAS_BLINK_FEATURES } });
  try {
    await win.loadFile(path.join(output, 'index.html'));
    const reports = [];
    const counts = process.env.CANVAS_PERFORMANCE_COUNTS?.split(',').map(Number) ?? [250, 2500, 12000];
    const kinds = z.array(z.enum(['text', 'image', 'document'])).parse(process.env.CANVAS_PERFORMANCE_KINDS?.split(',')
      ?? (process.env.CANVAS_PERFORMANCE_MEDIA === '1' ? ['image', 'document'] : ['text']));
    for (const kind of kinds) for (const count of counts) for (const clustered of [false, true]) {
      console.log(`Canvas formal body performance ${kind} ${count} ${clustered ? 'clustered' : 'uniform'}`);
      const initial: unknown = await win.webContents.executeJavaScript(`window.prepareCanvasPerformanceProbe(${count},${clustered},${JSON.stringify(kind)})`);
      if (softwareProfile) {
        const reduced = z.object({ resolution: z.number(), renderStatus: z.object({ limited: z.boolean(), message: z.string().nullable() }) }).parse(initial);
        if (!reduced.renderStatus.limited || !reduced.renderStatus.message || reduced.resolution > 1) throw new Error('software_gpu_did_not_reduce_rendering');
      }
      let mediaOverview: unknown = null;
      if (kind !== 'text') {
        const overviewState: unknown = await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
        await writeFile(path.join(output, `${kind}-${count}-${clustered ? 'cluster' : 'uniform'}-overview-settle.json`), JSON.stringify({ initial, overviewState }, null, 2));
        const settled = z.object({ settled: z.literal(true) }).passthrough().parse(overviewState);
        const scene = z.object({ scene: z.object({ viewportCards: z.literal(count) }) }).passthrough().parse(await win.webContents.executeJavaScript('window.verifyCanvasDeterministicCounts()'));
        const before: unknown = await win.webContents.executeJavaScript('window.readCanvasPerformanceMedia()'); await delay(250);
        const after: unknown = await win.webContents.executeJavaScript('window.readCanvasPerformanceMedia()');
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('settled_media_continues_refetching');
        const image = await win.webContents.capturePage(), pixels = image.toBitmap(); let patternPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 184) < 5 && Math.abs(pixels[i + 1] - 120) < 5 && Math.abs(pixels[i + 2] - 20) < 5) patternPixels++;
        if (patternPixels < 1000) throw new Error('media_overview_has_no_actual_thumbnail_pixels');
        await writeFile(path.join(output, `${kind}-${count}-${clustered ? 'cluster' : 'uniform'}-overview.png`), image.toPNG());
        mediaOverview = { settled, scene, before, after, patternPixels };
      }
      await delay(100);
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 800, y: 480, button: 'middle', clickCount: 1 });
      for (let i = 0; i < 50; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: 800 + i * 3, y: 480 + i }); await delay(20); }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 947, y: 529, button: 'middle', clickCount: 1 });
      const pan: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      if (process.env.CANVAS_PERFORMANCE_BODY_PROFILE === '1') { win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); }
      const close: unknown = await win.webContents.executeJavaScript('window.closeCanvasPerformanceView()');
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      const bodySettled: unknown = await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
      const bodyLoad: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      if (process.env.CANVAS_PERFORMANCE_BODY_PROFILE === '1') {
        const profile: unknown = await win.webContents.debugger.sendCommand('Profiler.stop');
        await writeFile(path.join(output, `${kind}-${count}-${clustered ? 'cluster' : 'uniform'}-body.cpuprofile`), JSON.stringify(profile)); win.webContents.debugger.detach();
      }
      await writeFile(path.join(output, `${kind === 'text' ? '' : kind + '-'}${count}-${clustered ? 'cluster' : 'uniform'}.png`), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
      for (let i = 0; i < 100; i++) { win.webContents.sendInputEvent({ type: 'mouseWheel', x: 800, y: 480,
        deltaY: i < 50 ? -5 : 5, deltaX: 0, modifiers: ['control'], canScroll: true }); await delay(20); }
      const zoom: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
      const zoomSettled: unknown = await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
      let drag: unknown;
      if (process.env.CANVAS_PERFORMANCE_DRAG === '1') {
        const target = z.object({ point: z.object({ x: z.number(), y: z.number() }), selected: z.number(), cardId: z.string() }).parse(await win.webContents.executeJavaScript('window.prepareCanvasPerformanceDrag(500)'));
        await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
        if (process.env.CANVAS_PERFORMANCE_CPU_PROFILE === '1') { win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); }
        win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(target.point.x), y: Math.round(target.point.y), button: 'left', clickCount: 1 });
        for (let i = 0; i < 50; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(target.point.x + i * 2), y: Math.round(target.point.y + i) }); await delay(20); }
        win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(target.point.x + 98), y: Math.round(target.point.y + 49), button: 'left', clickCount: 1 });
        if (process.env.CANVAS_PERFORMANCE_CPU_PROFILE === '1') {
          const profile: unknown = await win.webContents.debugger.sendCommand('Profiler.stop');
          await writeFile(path.join(output, `${kind === 'text' ? '' : kind + '-'}${count}-${clustered ? 'cluster' : 'uniform'}-drag.cpuprofile`), JSON.stringify(profile)); win.webContents.debugger.detach();
        }
        const frames: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
        const intents = z.object({ movedCards: z.number(), selected: z.number() }).parse(await win.webContents.executeJavaScript('window.finishCanvasPerformanceDrag()'));
        if (intents.movedCards !== target.selected) throw new Error(`native_drag_did_not_finish:${intents.movedCards}:${target.selected}`);
        drag = { target, frames, intents };
      }
      await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
      const counts: unknown = await win.webContents.executeJavaScript('window.verifyCanvasDeterministicCounts()');
      const report = { kind, count, clustered, initial, mediaOverview, pan, close, bodyLoad, bodySettled, zoom, zoomSettled, drag, counts };
      reports.push(report); console.log(JSON.stringify(report));
    }
    const idleAfter = powerMonitor.getSystemIdleState(1), display = screen.getDisplayMatching(win.getBounds());
    const nativeSessionAfter = offscreenProfile ? null : readNativeSessionState();
    const validDesktopRun = unlocked(idleAfter) && !lockEvents.some(event => event.event === 'lock')
      && (offscreenProfile || process.platform !== 'darwin' || nativeSessionAfter?.unlocked === true);
    const displayQualified = !requireInternal120 || display.id === targetDisplay?.id && display.internal && display.displayFrequency >= 119;
    const profiling = process.env.CANVAS_PERFORMANCE_CPU_PROFILE === '1' || process.env.CANVAS_PERFORMANCE_BODY_PROFILE === '1';
    const validHardwareRun = !offscreenProfile && validDesktopRun && displayQualified && !profiling;
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ fixtureVersion: kinds.every(kind => kind === 'text') ? 'production-dom-v4' : 'production-media-provider-v1', source: { commit: process.env.CANVAS_PROBE_SOURCE_COMMIT, dirty: process.env.CANVAS_PROBE_SOURCE_DIRTY === '1', rendererTree: process.env.CANVAS_PROBE_RENDERER_TREE }, startedAt, endedAt: new Date().toISOString(),
      renderingProfile: softwareProfile ? 'offscreen-swiftshader' : offscreenProfile ? 'offscreen-counts' : 'visible-hardware',
      versions: process.versions, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model,
      idleBefore, idleAfter, nativeSessionBefore, nativeSessionAfter, lockEvents, validHardwareRun, profiling, requireInternal120, displayQualified, thermalBefore, thermalAfter: powerMonitor.getCurrentThermalState(),
      display: { label: display.label, internal: display.internal, scaleFactor: display.scaleFactor, displayFrequency: display.displayFrequency, bounds: display.bounds },
      gpu: await app.getGPUInfo('basic'), reports }, null, 2));
    if (!displayQualified) throw new Error('Native benchmark left its requested internal 120Hz display');
    if (!offscreenProfile && !validDesktopRun) throw new Error('Desktop locked during native performance benchmark');
  } finally { win.destroy(); }
}
void mkdir(output, { recursive: true }).then(run).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
