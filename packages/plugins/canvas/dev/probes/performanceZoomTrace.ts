import { contentTracing, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Electron43的contentTracing与Chromium/Playwright使用同一类timeline/profile事件；
// 直接在trace里保存CPU样本，不把独立Profiler时钟猜测成rAF或GPU时间。
const categories = ['devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler', 'v8', 'v8.execute', 'blink.user_timing',
  'toplevel', 'gpu', 'cc', 'viz', 'renderer.scheduler'];

/** 仅诊断单次真实zoom；正常Native门禁不安装逐帧观察器。 */
export async function startCanvasZoomTrace(window: BrowserWindow, output: string, stem: string) {
  await contentTracing.startRecording({ included_categories: categories,
    recording_mode: 'record-until-full', trace_buffer_size_in_kb: 16384 });
  await window.webContents.executeJavaScript('window.startCanvasPerformanceZoomTrace()');
  return async () => {
    const timeline: unknown = await window.webContents.executeJavaScript('window.finishCanvasPerformanceZoomTrace()');
    const buffer = await contentTracing.getTraceBufferUsage();
    const traceFile = await contentTracing.stopRecording(path.join(output, `${stem}-zoom.trace.json`));
    await writeFile(path.join(output, `${stem}-zoom-timeline.json`), JSON.stringify({
      diagnostic: true, categories, traceFile, buffer, timeline,
      note: 'UserTiming marks, rAF gaps, CPU ProfileChunks, GC and GPU-track events share the Chromium trace; native host calls are not GPU execution durations.',
    }, null, 2));
  };
}
