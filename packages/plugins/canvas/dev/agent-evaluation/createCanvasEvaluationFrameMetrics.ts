export interface CanvasEvaluationFrameSample { readonly at: number; readonly interval: number }
/** 开发验收观测：保留有界真实RAF时刻，调用方必须选择实际工作窗口，不能以模型等待期当流畅度。 */
export function createCanvasEvaluationFrameMetrics() {
  const times = new Float64Array(4096), intervals = new Float64Array(4096);
  const listeners = new Set<(sample: CanvasEvaluationFrameSample) => void>();
  let index = 0, count = 0, previous: number | null = null, disposed = false, frame = 0;
  const reset = () => { index = 0; count = 0; previous = null; };
  const sample = (time: number) => {
    if (disposed) return;
    if (document.visibilityState === 'visible') {
      if (previous !== null) {
        const interval = time - previous; times[index] = time; intervals[index] = interval; index = (index + 1) % times.length; count = Math.min(count + 1, times.length);
        for (const listener of listeners) listener({ at: performance.timeOrigin + time, interval });
      }
      previous = time;
    } else previous = null;
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  return { reset,
    subscribe(listener: (sample: CanvasEvaluationFrameSample) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read() {
      const samples = Array.from({ length: count }, (_, offset) => { const position = (index - count + offset + times.length) % times.length; return { at: times[position], interval: intervals[position] }; });
      const sorted = samples.map(sample => sample.interval).sort((a, b) => a - b), total = sorted.reduce((sum, value) => sum + value, 0);
      return { kind: 'animation-frame-callbacks', visibility: document.visibilityState, focused: document.hasFocus(), performanceTimeOrigin: performance.timeOrigin, sampleCount: count,
        averageFps: total ? count * 1000 / total : null, frameP95Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : null, worstFrameMs: sorted.length ? sorted[sorted.length - 1] : null, samples };
    },
    dispose() { disposed = true; listeners.clear(); cancelAnimationFrame(frame); },
  };
}
