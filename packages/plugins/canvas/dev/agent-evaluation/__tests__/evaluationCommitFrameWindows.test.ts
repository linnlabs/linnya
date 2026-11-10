import { expect, it } from 'vitest';
import { createCanvasEvaluationCommitFrameWindows } from '../createCanvasEvaluationCommitFrameWindows';
import type { CanvasEvaluationFrameSample } from '../createCanvasEvaluationFrameMetrics';

it('只保留真实提交工作窗的帧间隔，模型结束前的长空闲不覆盖或稀释这次卡顿', () => {
  const listeners = new Set<(sample: CanvasEvaluationFrameSample) => void>();
  const windows = createCanvasEvaluationCommitFrameWindows({ subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  const sample = (at: number, interval: number) => { for (const listener of listeners) listener({ at, interval }); };
  windows.begin(1, 100, 'backend-commit'); sample(90, 8); sample(120, 50); sample(140, 20);
  const first = windows.finish(1); sample(10000, 8);
  expect(first).toMatchObject({ basis: 'backend-commit', sampleCount: 2, worstFrameMs: 50, intervals: [50, 20] });
  expect(first?.averageFps).toBeCloseTo(2000 / 70); expect(windows.finish(1)).toBeNull();
  windows.dispose(); expect(listeners.size).toBe(0);
});
