import type { CanvasEvaluationFrameSample } from './createCanvasEvaluationFrameMetrics';
interface FrameWindow { readonly since: number; readonly basis: 'backend-commit' | 'push-received'; readonly intervals: number[] }
export function createCanvasEvaluationCommitFrameWindows(frames: { subscribe(listener: (sample: CanvasEvaluationFrameSample) => void): () => void }) {
  const windows = new Map<number, FrameWindow>();
  const unsubscribe = frames.subscribe(sample => {
    for (const window of windows.values()) if (sample.at >= window.since && window.intervals.length < 2048) window.intervals.push(sample.interval);
  });
  return {
    begin(sequence: number, since: number, basis: FrameWindow['basis']) { windows.set(sequence, { since, basis, intervals: [] }); },
    finish(sequence: number) {
      const window = windows.get(sequence); if (!window) return null; windows.delete(sequence);
      const intervals = [...window.intervals].sort((a, b) => a - b), total = intervals.reduce((sum, value) => sum + value, 0);
      return { kind: 'animation-frame-intervals-during-commit-work', since: window.since, basis: window.basis, sampleCount: intervals.length,
        averageFps: total ? intervals.length * 1000 / total : null, frameP95Ms: intervals.length ? intervals[Math.floor((intervals.length - 1) * 0.95)] : null,
        worstFrameMs: intervals.length ? intervals[intervals.length - 1] : null, intervals: window.intervals };
    },
    clear() { windows.clear(); },
    dispose() { windows.clear(); unsubscribe(); },
  };
}
