import { contentTracing } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Electron43的contentTracing与Chromium/Playwright使用同一类timeline/profile事件；
// 直接在trace里保存CPU样本，不把独立Profiler时钟猜测成rAF或GPU时间。
// Electron43.8.1绑定的Chromium150在DawnPlatform::GetTraceCategoryEnabledFlag中
// 将Dawn内部事件统一映射到此默认关闭的类别，单独的gpu不会包含它。
const dawnCategory = 'disabled-by-default-gpu.dawn';
const categories = ['devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler', 'v8', 'v8.execute', 'blink.user_timing',
  'toplevel', 'gpu', dawnCategory, 'cc', 'viz', 'renderer.scheduler'];

/** 仅诊断单次真实zoom；正常Native门禁不安装逐帧观察器。 */
export async function startCanvasZoomTrace(window: {
  readonly webContents: { executeJavaScript(code: string): Promise<unknown> };
}, output: string, stem: string) {
  const traceFile = path.join(output, `${stem}-zoom.trace.json`), factsFile = path.join(output, `${stem}-zoom-timeline.json`);
  const availableCategories = await contentTracing.getCategories();
  const dawnCategoryAvailable = availableCategories.includes(dawnCategory);
  const failed = (stage: string, error: unknown) => writeFile(factsFile, JSON.stringify({ diagnostic: true,
    categories, availableCategories, dawnCategoryAvailable, traceFile,
    failure: { stage, message: error instanceof Error ? error.message : String(error) } }, null, 2));
  await contentTracing.startRecording({ included_categories: categories,
    recording_mode: 'record-until-full', trace_buffer_size_in_kb: 16384 });
  try { await window.webContents.executeJavaScript('window.startCanvasPerformanceZoomTrace()'); }
  catch (error) {
    // Renderer崩溃/页面切换正是需要保留现场的情况；工厂未返回也必须释放自己的录制。
    try { await failed('renderer_start', error); } finally { await contentTracing.stopRecording(traceFile); }
    throw error;
  }
  return async () => {
    try {
      const timeline: unknown = await window.webContents.executeJavaScript('window.finishCanvasPerformanceZoomTrace()');
      const buffer = await contentTracing.getTraceBufferUsage();
      await writeFile(factsFile, JSON.stringify({ diagnostic: true, categories, availableCategories, dawnCategoryAvailable, traceFile, buffer, timeline,
        note: 'UserTiming marks, rAF gaps, CPU ProfileChunks, GC and GPU-track events share the Chromium trace; native host calls are not GPU execution durations.',
      }, null, 2));
    } catch (error) { await failed('renderer_finish_or_buffer', error); throw error; }
    finally { await contentTracing.stopRecording(traceFile); }
  };
}
