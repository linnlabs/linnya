export interface CanvasEvaluationFrameSample { readonly at: number; readonly interval: number }
function summarize(samples: readonly CanvasEvaluationFrameSample[]) {
  const sorted = samples.map(sample => sample.interval).sort((a, b) => a - b), total = sorted.reduce((sum, value) => sum + value, 0);
  return { sampleCount: samples.length, averageFps: total ? samples.length * 1000 / total : null,
    frameP95Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : null,
    worstFrameMs: sorted.length ? sorted[sorted.length - 1] : null, samples };
}
/** 开发验收观测：保留有界真实RAF时刻，调用方必须选择实际工作窗口，不能以模型等待期当流畅度。 */
export function createCanvasEvaluationFrameMetrics() {
  const times = new Float64Array(4096), intervals = new Float64Array(4096);
  const listeners = new Set<(sample: CanvasEvaluationFrameSample) => void>();
  let index = 0, count = 0, previous: number | null = null, disposed = false, frame = 0;
  let retainedSince = performance.timeOrigin + performance.now();
  const reset = () => { index = 0; count = 0; previous = null; retainedSince = performance.timeOrigin + performance.now(); };
  const sample = (time: number) => {
    if (disposed) return;
    if (document.visibilityState === 'visible') {
      if (previous !== null) {
        if (count === times.length) retainedSince = Math.max(retainedSince, performance.timeOrigin + times[index]);
        const interval = time - previous; times[index] = time; intervals[index] = interval; index = (index + 1) % times.length; count = Math.min(count + 1, times.length);
        for (const listener of listeners) listener({ at: performance.timeOrigin + time, interval });
      }
      previous = time;
    } else {
      previous = null;
      // 隐藏期间没有完整RAF链；保留旧raw供诊断，但有效边界不能被后续ring淘汰退回。
      retainedSince = Math.max(retainedSince, performance.timeOrigin + time);
    }
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  const readSamples = () => Array.from({ length: count }, (_, offset) => { const position = (index - count + offset + times.length) % times.length; return { at: times[position], interval: intervals[position] }; });
  return { reset,
    subscribe(listener: (sample: CanvasEvaluationFrameSample) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read() {
      return { kind: 'animation-frame-callbacks', visibility: document.visibilityState, focused: document.hasFocus(), performanceTimeOrigin: performance.timeOrigin, ...summarize(readSamples()) };
    },
    readWindow(since: number, until: number) {
      const observedAt = performance.timeOrigin + performance.now();
      const recorded = readSamples().map(sample => ({ ...sample, at: performance.timeOrigin + sample.at }));
      // 首帧可能跨提交起点并包含主要卡顿，不能剔除；完整间隔保守统计，并显式列出越界事实。
      const samples = recorded.filter(sample => sample.at > since && sample.at - sample.interval < until);
      const contained = samples.filter(sample => sample.at - sample.interval >= since && sample.at <= until);
      const capturedThrough = recorded.length ? recorded[recorded.length - 1].at : retainedSince;
      const first = samples[0], last = samples[samples.length - 1];
      // reset时刻不等于首个RAF基线；元数据已覆盖时段，也可能仍缺真正跨首尾的完整interval。
      const boundariesCovered = !!first && !!last && first.at - first.interval <= since && last.at >= until;
      return { kind: 'animation-frame-callbacks-in-explicit-window', since, until, observedAt, retainedSince,
        capturedThrough, retentionComplete: !disposed && since >= retainedSince && until <= capturedThrough && boundariesCovered,
        visibility: document.visibilityState, focused: document.hasFocus(), ...summarize(samples),
        boundarySamples: samples.filter(sample => sample.at - sample.interval < since || sample.at > until), contained: summarize(contained) };
    },
    dispose() { disposed = true; listeners.clear(); cancelAnimationFrame(frame); },
  };
}
