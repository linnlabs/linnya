import { app, BrowserWindow, powerMonitor, screen, type WebContents } from 'electron';
import os from 'node:os';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { HTML_CANVAS_BLINK_FEATURES } from '../../../../../src/electron-main/desktop-capabilities/html-canvas/definitions/htmlCanvasWindowPreferences';
import { z } from 'zod';
import { readNativeSessionState } from './readNativeSessionState';
import { verifyCanvasMediaOverview } from './performanceMediaOverview';
import { startCanvasZoomTrace } from './performanceZoomTrace';
import { startCanvasPaintTrace } from './performancePaintTraceElectron';
import { performance } from 'node:perf_hooks';
import { startCanvasPerformanceInputTrace } from './performanceInputTraceElectron';
import { createCanvasPerformanceFocusQualification } from './performanceFocusQualification';
import { startCanvasPhaseTrace } from './canvasPhaseTrace';
import { readCanvasPerformanceContextControl } from './performanceContextControl';

const output = process.argv[2];
if (!output) throw new Error('Performance output directory required');
app.setPath('userData', path.join(output, 'profile'));
const softwareProfile = process.env.CANVAS_PERFORMANCE_SOFTWARE === '1';
const offscreenProfile = softwareProfile || process.env.CANVAS_PERFORMANCE_OFFSCREEN === '1';
const zoomPaintDiagnostic = process.env.CANVAS_PERFORMANCE_ZOOM_PAINT_TRACE === '1';
const bodyDiagnostic = process.env.CANVAS_PERFORMANCE_BODY_TRACE === '1';
const paintDiagnostic = process.env.CANVAS_PERFORMANCE_PAINT_TRACE === '1' || zoomPaintDiagnostic || bodyDiagnostic;
const comparisonDiagnostic = process.env.CANVAS_PERFORMANCE_COMPARISON === '1';
const inputDiagnostic = process.env.CANVAS_PERFORMANCE_INPUT_TRACE === '1';
const contextControl = readCanvasPerformanceContextControl({ staging: process.env.CANVAS_PERFORMANCE_STAGING_CONTEXT_CONTROL,
  tile: process.env.CANVAS_PERFORMANCE_TILE_CONTEXT_CONTROL, bodyTrace: bodyDiagnostic });
const profiling = process.env.CANVAS_PERFORMANCE_CPU_PROFILE === '1' || process.env.CANVAS_PERFORMANCE_BODY_PROFILE === '1' || process.env.CANVAS_PERFORMANCE_RESOURCE_PROFILE === '1' || process.env.CANVAS_PERFORMANCE_ZOOM_TRACE === '1' || paintDiagnostic;
if (bodyDiagnostic && (inputDiagnostic || ['CPU_PROFILE', 'BODY_PROFILE', 'RESOURCE_PROFILE', 'ZOOM_TRACE', 'ZOOM_PAINT_TRACE']
  .some(flag => process.env[`CANVAS_PERFORMANCE_${flag}`] === '1'))) throw new Error('body_trace_conflicting_recording');
if (inputDiagnostic && offscreenProfile) throw new Error('input_trace_requires_visible_window');
if (zoomPaintDiagnostic && process.env.CANVAS_PERFORMANCE_ZOOM_TRACE !== '1') throw new Error('zoom_paint_diagnostic_requires_chromium_trace');
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
  if (paintDiagnostic) win.webContents.on('console-message', event => {
    if (event.message.startsWith('[Canvas] HTML paint timeout')) console.error(event.message);
  });
  let inputTrace: Awaited<ReturnType<typeof startCanvasPerformanceInputTrace>> | null = null;
  let failed = false;
  try {
    await win.loadFile(path.join(output, 'index.html'));
    if (inputDiagnostic) inputTrace = await startCanvasPerformanceInputTrace(win, output, profiling);
    const send: WebContents['sendInputEvent'] = inputTrace ? inputTrace.send : input => win.webContents.sendInputEvent(input);
    const reports = [];
    const counts = bodyDiagnostic ? [12000] : inputDiagnostic ? [2500] : process.env.CANVAS_PERFORMANCE_COUNTS?.split(',').map(Number) ?? [250, 2500, 12000];
    const kinds = z.array(z.enum(['text', 'image', 'document'])).parse(bodyDiagnostic ? ['text'] : inputDiagnostic ? ['image'] : process.env.CANVAS_PERFORMANCE_KINDS?.split(',')
      ?? (process.env.CANVAS_PERFORMANCE_MEDIA === '1' ? ['image', 'document'] : ['text']));
    const distributions = z.array(z.enum(['uniform', 'cluster'])).parse(bodyDiagnostic ? ['cluster'] : inputDiagnostic ? ['uniform'] : process.env.CANVAS_PERFORMANCE_DISTRIBUTIONS?.split(',') ?? ['uniform', 'cluster']);
    for (const kind of kinds) for (const count of counts) for (const distribution of distributions) {
      const clustered = distribution === 'cluster';
      console.log(`Canvas formal body performance ${kind} ${count} ${clustered ? 'clustered' : 'uniform'}`);
      const stopPaintTrace = paintDiagnostic && !zoomPaintDiagnostic && !bodyDiagnostic ? await startCanvasPaintTrace(win.webContents, output, `${kind}-${count}-${distribution}`) : null;
      const progress: { stage: string; values: Record<string, unknown> } = { stage: 'prepare', values: {} };
      const focus = createCanvasPerformanceFocusQualification(win, process.env.CANVAS_PERFORMANCE_DRAG === '1' || inputDiagnostic ? ['pan', 'zoom', 'drag'] : ['pan', 'zoom'],
        { now: () => performance.now(), timeOrigin: performance.timeOrigin });
      let contextStopped = false;
      try {
        const resourceProfile = kind !== 'text' && process.env.CANVAS_PERFORMANCE_RESOURCE_PROFILE === '1';
        if (resourceProfile) { win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); }
        const contextArgument = contextControl ? `,${JSON.stringify(contextControl)}` : '';
        const initial: unknown = await win.webContents.executeJavaScript(`window.prepareCanvasPerformanceProbe(${count},${clustered},${JSON.stringify(kind)}${contextArgument})`);
        progress.values.initial = initial;
        if (softwareProfile) {
          const reduced = z.object({ resolution: z.number(), renderStatus: z.object({ limited: z.boolean(), message: z.string().nullable() }) }).parse(initial);
          if (!reduced.renderStatus.limited || !reduced.renderStatus.message || reduced.resolution > 1) throw new Error('software_gpu_did_not_reduce_rendering');
        }
        let mediaOverview: unknown = null;
        progress.stage = 'overview';
        if (kind !== 'text') {
          mediaOverview = await verifyCanvasMediaOverview({ window: win, output, kind, count, clustered, initial, resourceProfile });
        }
        progress.values.mediaOverview = mediaOverview; progress.stage = 'pan';
        await delay(100);
        await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
        focus.begin('pan');
        send({ type: 'mouseDown', x: 800, y: 480, button: 'middle', clickCount: 1 });
        for (let i = 0; i < 50; i++) { send({ type: 'mouseMove', x: 800 + i * 3, y: 480 + i }); await delay(20); }
        send({ type: 'mouseUp', x: 947, y: 529, button: 'middle', clickCount: 1 });
        const pan: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
        progress.values.pan = pan; focus.finish(pan); progress.stage = 'body';
        const { bodyBaseline, close, bodySettled, bodyLoad } = await collectBody(win, `${kind}-${count}-${distribution}`, progress.values);
        await writeFile(path.join(output, `${kind === 'text' ? '' : kind + '-'}${count}-${clustered ? 'cluster' : 'uniform'}.png`), (await win.webContents.capturePage()).toPNG());
        progress.stage = 'zoom';
        const zoom: unknown = await collectZoom(win, `${kind}-${count}-${distribution}`, send, () => focus.begin('zoom'));
        progress.values.zoom = zoom;
        focus.finish(zoom);
        const zoomSettled: unknown = await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
        progress.values.zoomSettled = zoomSettled;
        let drag: unknown;
        if (process.env.CANVAS_PERFORMANCE_DRAG === '1' || inputDiagnostic) {
          progress.stage = 'drag-prepare';
          const target = z.object({ point: z.object({ x: z.number(), y: z.number() }), selected: z.number(), cardId: z.string() }).parse(await win.webContents.executeJavaScript('window.prepareCanvasPerformanceDrag(500)'));
          progress.values.drag = { target }; progress.stage = 'drag';
          await win.webContents.executeJavaScript('window.startCanvasPerformanceCollection()');
          focus.begin('drag');
          if (process.env.CANVAS_PERFORMANCE_CPU_PROFILE === '1') { win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); }
          send({ type: 'mouseDown', x: Math.round(target.point.x), y: Math.round(target.point.y), button: 'left', clickCount: 1 });
          for (let i = 0; i < 50; i++) { send({ type: 'mouseMove', x: Math.round(target.point.x + i * 2), y: Math.round(target.point.y + i) }); await delay(20); }
          send({ type: 'mouseUp', x: Math.round(target.point.x + 98), y: Math.round(target.point.y + 49), button: 'left', clickCount: 1 });
          if (process.env.CANVAS_PERFORMANCE_CPU_PROFILE === '1') {
            const profile: unknown = await win.webContents.debugger.sendCommand('Profiler.stop');
            await writeFile(path.join(output, `${kind === 'text' ? '' : kind + '-'}${count}-${clustered ? 'cluster' : 'uniform'}-drag.cpuprofile`), JSON.stringify(profile)); win.webContents.debugger.detach();
          }
          const frames: unknown = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
          progress.values.drag = { target, frames };
          focus.finish(frames);
          const intents = z.object({ movedCards: z.number(), selected: z.number() }).parse(await win.webContents.executeJavaScript('window.finishCanvasPerformanceDrag()'));
          drag = { target, frames, intents }; progress.values.drag = drag;
          if (intents.movedCards !== target.selected) throw new Error(`native_drag_did_not_finish:${intents.movedCards}:${target.selected}`);
        }
        progress.stage = 'final-body-and-counts';
        await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
        const counts: unknown = await win.webContents.executeJavaScript('window.verifyCanvasDeterministicCounts()');
        let contextFacts: unknown;
        if (contextControl) {
          contextStopped = true; contextFacts = await finishContextControl(win, `${kind}-${count}-${distribution}`);
          if (!z.object({ effective: z.boolean() }).parse(contextFacts).effective) throw new Error(`${contextControl.kind}_context_control_ineffective`);
        }
        const report = { kind, count, clustered, initial, mediaOverview, pan, close, bodyBaseline, bodyLoad, bodySettled, zoom, zoomSettled, drag, counts, inputQualification: focus.read(),
          ...(contextControl ? { contextControl: contextFacts } : {}) };
        reports.push(report); console.log(JSON.stringify(report));
      } catch (error) {
        focus.abort();
        // 失败路径才取回最后的采集段并卸载Renderer blur监听，不改正常动作/时序。
        try { progress.values.failureCollection = await win.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()'); }
        catch (cleanupError) { progress.values.focusCleanupFailure = cleanupError instanceof Error ? cleanupError.message : String(cleanupError); }
        await writeFile(path.join(output, `${kind}-${count}-${distribution}-failure-progress.json`), JSON.stringify({ kind, count, clustered, ...progress,
          inputQualification: focus.read(),
          timeOrigin: performance.timeOrigin, failedAtMs: performance.now(),
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }, null, 2));
        throw error;
      } finally {
        focus.abort();
        try { if (contextControl && !contextStopped) { contextStopped = true; await finishContextControl(win, `${kind}-${count}-${distribution}`); } }
        finally { await stopPaintTrace?.(); }
      }
    }
    const idleAfter = powerMonitor.getSystemIdleState(1), display = screen.getDisplayMatching(win.getBounds());
    const nativeSessionAfter = offscreenProfile ? null : readNativeSessionState();
    const validDesktopRun = unlocked(idleAfter) && !lockEvents.some(event => event.event === 'lock')
      && (offscreenProfile || process.platform !== 'darwin' || nativeSessionAfter?.unlocked === true);
    const displayQualified = !requireInternal120 || display.id === targetDisplay?.id && display.internal && display.displayFrequency >= 119;
    const inputQualified = reports.every(report => report.inputQualification.qualified);
    const validHardwareRun = !offscreenProfile && validDesktopRun && displayQualified && inputQualified && !profiling && !comparisonDiagnostic && !inputDiagnostic;
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ fixtureVersion: kinds.every(kind => kind === 'text') ? 'production-dom-v5-body-baseline' : 'production-media-provider-v2-body-baseline', source: { commit: process.env.CANVAS_PROBE_SOURCE_COMMIT, dirty: process.env.CANVAS_PROBE_SOURCE_DIRTY === '1', rendererTree: process.env.CANVAS_PROBE_RENDERER_TREE }, startedAt, endedAt: new Date().toISOString(),
      renderingProfile: softwareProfile ? 'offscreen-swiftshader' : offscreenProfile ? 'offscreen-counts' : 'visible-hardware',
      ...(contextControl ? { diagnostic: `body-${contextControl.kind}-context-control`, contextControl } : bodyDiagnostic ? { diagnostic: 'body-task-trace' } : inputDiagnostic ? { diagnostic: 'input-trace' } : comparisonDiagnostic ? { diagnostic: 'comparison' } : paintDiagnostic ? { diagnostic: zoomPaintDiagnostic ? 'zoom-paint-trace' : 'paint-trace' } : {}),
      versions: process.versions, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model,
      idleBefore, idleAfter, nativeSessionBefore, nativeSessionAfter, lockEvents, validHardwareRun, profiling, requireInternal120, displayQualified, inputQualified, thermalBefore, thermalAfter: powerMonitor.getCurrentThermalState(),
      display: { label: display.label, internal: display.internal, scaleFactor: display.scaleFactor, displayFrequency: display.displayFrequency, bounds: display.bounds },
      gpu: await app.getGPUInfo('basic'), reports }, null, 2));
    if (!displayQualified) throw new Error('Native benchmark left its requested internal 120Hz display');
    if (!offscreenProfile && !validDesktopRun) throw new Error('Desktop locked during native performance benchmark');
  } catch (error) { failed = true; throw error; }
  finally {
    try { await inputTrace?.finish(); }
    catch (error) { if (!failed) throw error; console.error('Input trace cleanup failed after original case failure', error); }
    finally { win.destroy(); }
  }
}

async function finishContextControl(window: BrowserWindow, stem: string): Promise<unknown> {
  const facts: unknown = await window.webContents.executeJavaScript('window.finishCanvasPerformanceContextControl()');
  await writeFile(path.join(output, `${stem}-${contextControl?.kind === 'tile' ? 'tile-' : ''}context-control.json`), JSON.stringify(facts, null, 2));
  return facts;
}

async function collectBody(window: BrowserWindow, stem: string, progress: Record<string, unknown>) {
  let phaseReturned = false;
  const stopTrace = bodyDiagnostic ? await startCanvasPhaseTrace({ output, stem, phase: 'body', start: async () => null,
    finish: async () => ({ phaseReturned, bodyBaseline: progress.bodyBaseline, close: progress.close,
      bodySettled: progress.bodySettled, bodyLoad: progress.bodyLoad }) }) : null;
  let stopPaint: (() => Promise<void>) | null = null;
  try {
    if (bodyDiagnostic) stopPaint = await startCanvasPaintTrace(window.webContents, output, `${stem}-body`);
    if (process.env.CANVAS_PERFORMANCE_BODY_PROFILE === '1') { window.webContents.debugger.attach('1.3'); await window.webContents.debugger.sendCommand('Profiler.enable'); await window.webContents.debugger.sendCommand('Profiler.start'); }
    const bodyBaseline = z.number().parse(await window.webContents.executeJavaScript(bodyDiagnostic ? 'window.startCanvasPerformanceBaseline(true)' : 'window.startCanvasPerformanceBaseline()'));
    progress.bodyBaseline = bodyBaseline;
    const close: unknown = await window.webContents.executeJavaScript('window.closeCanvasPerformanceView()'); progress.close = close;
    const bodySettled: unknown = await window.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()'); progress.bodySettled = bodySettled;
    const bodyLoad: unknown = await window.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()'); progress.bodyLoad = bodyLoad;
    if (process.env.CANVAS_PERFORMANCE_BODY_PROFILE === '1') {
      const profile: unknown = await window.webContents.debugger.sendCommand('Profiler.stop');
      await writeFile(path.join(output, `${stem}-body.cpuprofile`), JSON.stringify(profile)); window.webContents.debugger.detach();
    }
    phaseReturned = true; return { bodyBaseline, close, bodySettled, bodyLoad };
  } finally {
    // paint事实收口失败也必须flush原生trace；正常入口不启动这两个观察器。
    if (stopTrace) { try { await stopPaint?.(); } finally { await stopTrace(); } }
  }
}

async function collectZoom(window: BrowserWindow, stem: string, send: WebContents['sendInputEvent'], beginFocus: () => void): Promise<unknown> {
  const stopTrace = process.env.CANVAS_PERFORMANCE_ZOOM_TRACE === '1' ? await startCanvasZoomTrace(window, output, stem, zoomPaintDiagnostic) : null;
  let stopPaint: (() => Promise<void>) | null = null;
  const sent: { readonly index: number; readonly deltaY: number; readonly beforeEpochMs: number; readonly afterEpochMs: number }[] | null = zoomPaintDiagnostic ? [] : null;
  try {
    if (zoomPaintDiagnostic) stopPaint = await startCanvasPaintTrace(window.webContents, output, `${stem}-zoom`);
    await window.webContents.executeJavaScript(stopTrace ? 'window.startCanvasPerformanceBaseline()' : 'window.startCanvasPerformanceCollection()');
    beginFocus();
    for (let i = 0; i < 100; i++) {
      const beforeEpochMs = sent ? performance.timeOrigin + performance.now() : 0;
      send({ type: 'mouseWheel', x: 800, y: 480, deltaY: i < 50 ? -5 : 5,
        deltaX: 0, modifiers: ['control'], canScroll: true });
      sent?.push({ index: i, deltaY: i < 50 ? -5 : 5, beforeEpochMs, afterEpochMs: performance.timeOrigin + performance.now() });
      await delay(20);
    }
    return await window.webContents.executeJavaScript('window.finishCanvasPerformanceCollection()');
  } finally {
    try { if (sent) await writeFile(path.join(output, `${stem}-zoom-wheel-inputs.json`), JSON.stringify({ clock: 'node-performance.timeOrigin+now; compare with Renderer timeOrigin', sent }, null, 2)); }
    finally { try { await stopPaint?.(); } finally { await stopTrace?.(); } }
  }
}
void mkdir(output, { recursive: true }).then(run).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
