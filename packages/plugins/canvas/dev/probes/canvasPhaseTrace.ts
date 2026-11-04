import { contentTracing } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Electron43/Chromium150的实际类别；不切换GPU后端，不将host调用当作设备执行时长。
const dawnCategory = 'disabled-by-default-gpu.dawn';
const categories = ['devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler', 'v8', 'v8.execute', 'blink.user_timing',
  'toplevel', 'gpu', dawnCategory, 'blink', 'cc', 'viz', 'renderer.scheduler'];

/** 固定阶段诊断共用原有录制/清理合同；业务动作与观察API仍由各入口拥有。 */
export async function startCanvasPhaseTrace(options: {
  readonly output: string; readonly stem: string; readonly phase: 'zoom' | 'visible-update' | 'body';
  readonly start: () => Promise<unknown>; readonly finish: () => Promise<unknown>;
}) {
  const traceFile = path.join(options.output, `${options.stem}-${options.phase}.trace.json`);
  const factsFile = path.join(options.output, `${options.stem}-${options.phase}-timeline.json`);
  const availableCategories = await contentTracing.getCategories();
  const dawnCategoryAvailable = availableCategories.includes(dawnCategory);
  const failed = (stage: string, error: unknown) => writeFile(factsFile, JSON.stringify({ diagnostic: true,
    categories, availableCategories, dawnCategoryAvailable, traceFile,
    failure: { stage, message: error instanceof Error ? error.message : String(error) } }, null, 2));
  await contentTracing.startRecording({ included_categories: categories,
    recording_mode: 'record-until-full', trace_buffer_size_in_kb: 16384 });
  try { await options.start(); }
  catch (error) {
    try { await failed('renderer_start', error); } finally { await contentTracing.stopRecording(traceFile); }
    throw error;
  }
  return async () => {
    try {
      const timeline = await options.finish(), buffer = await contentTracing.getTraceBufferUsage();
      await writeFile(factsFile, JSON.stringify({ diagnostic: true, categories, availableCategories, dawnCategoryAvailable, traceFile, buffer, timeline,
        note: 'UserTiming marks, rAF gaps, CPU ProfileChunks, GC and GPU-track events share the Chromium trace; native host calls are not GPU execution durations.',
      }, null, 2));
    } catch (error) { await failed('renderer_finish_or_buffer', error); throw error; }
    finally { await contentTracing.stopRecording(traceFile); }
  };
}
