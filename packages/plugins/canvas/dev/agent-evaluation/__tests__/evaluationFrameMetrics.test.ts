import { expect, it, vi } from 'vitest';
import { createCanvasEvaluationFrameMetrics } from '../createCanvasEvaluationFrameMetrics';

function fixture() {
  let now = 0, nextId = 0, visible = true;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('performance', { timeOrigin: 0, now: () => now });
  vi.stubGlobal('document', { get visibilityState() { return visible ? 'visible' : 'hidden'; }, hasFocus: () => visible });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId; callbacks.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
  const metrics = createCanvasEvaluationFrameMetrics();
  return { metrics, step(at: number) {
    now = at;
    const pending = [...callbacks.values()]; callbacks.clear();
    for (const callback of pending) callback(at);
  }, setVisible(value: boolean) { visible = value; }, dispose() { metrics.dispose(); vi.unstubAllGlobals(); } };
}

it('初始化空帧和首个RAF之前没有真实基线的区间不能称完整工作窗', () => {
  const f = fixture();
  try {
    expect(f.metrics.readWindow(0, 0)).toMatchObject({ retentionComplete: false, sampleCount: 0, worstFrameMs: null });
    f.step(16); f.step(32);
    // retainedSince=0/capturedThrough=32仍不能证明[5,16]，不能靠metadata补完整性。
    expect(f.metrics.readWindow(5, 24)).toMatchObject({ retainedSince: 0, capturedThrough: 32,
      retentionComplete: false, samples: [{ at: 32, interval: 16 }] });
    expect(f.metrics.readWindow(20, 24).retentionComplete).toBe(true);
  } finally { f.dispose(); }
});

it('跨提交首慢帧105ms和跨settled尾帧均保留，晚来的空闲帧不扩大固定统计窗', () => {
  const f = fixture();
  try {
    f.step(100); f.step(205);
    expect(f.metrics.readWindow(105, 230)).toMatchObject({ retentionComplete: false,
      samples: [{ at: 205, interval: 105 }], worstFrameMs: 105 });
    f.step(238);
    const closed = f.metrics.readWindow(105, 230);
    expect(closed).toMatchObject({ retentionComplete: true, sampleCount: 2, worstFrameMs: 105,
      samples: [{ at: 205, interval: 105 }, { at: 238, interval: 33 }],
      boundarySamples: [{ at: 205, interval: 105 }, { at: 238, interval: 33 }] });
    expect(closed.averageFps).toBeCloseTo(2000 / 138);
    f.step(246); f.step(254); f.step(10000);
    expect(f.metrics.readWindow(105, 230)).toMatchObject({ retentionComplete: true,
      samples: closed.samples, averageFps: closed.averageFps, worstFrameMs: 105 });
  } finally { f.dispose(); }
});

it('reset后先建立真实interval再开始下一提交，旧窗口丢失不能由新基线填补', () => {
  const f = fixture();
  try {
    f.step(100); f.step(108); f.metrics.reset(); f.step(116); f.step(124);
    expect(f.metrics.readWindow(105, 120).retentionComplete).toBe(false);
    expect(f.metrics.readWindow(109, 120)).toMatchObject({ retainedSince: 108, capturedThrough: 124,
      retentionComplete: false, samples: [{ at: 124, interval: 8 }] });
    f.step(132);
    expect(f.metrics.readWindow(125, 130)).toMatchObject({ retentionComplete: true,
      samples: [{ at: 132, interval: 8 }] });
  } finally { f.dispose(); }
});

it('真实hidden断点使跨洞窗口不完整，保留raw且满ring淘汰不能退回有效边界', () => {
  const f = fixture();
  try {
    f.step(100); f.step(110); f.setVisible(false); f.step(120);
    f.setVisible(true); f.step(200); f.step(210);
    expect(f.metrics.readWindow(105, 205)).toMatchObject({ retentionComplete: false, retainedSince: 120,
      focused: true, samples: [{ at: 110, interval: 10 }, { at: 210, interval: 10 }] });
    expect(f.metrics.readWindow(205, 208).retentionComplete).toBe(true);
    for (let at = 211; at <= 4350; at++) f.step(at);
    f.setVisible(false); f.step(5000); f.setVisible(true); f.step(5100); f.step(5110);
    expect(f.metrics.readWindow(4345, 5105)).toMatchObject({ retainedSince: 5000, retentionComplete: false });
    f.step(5120);
    expect(f.metrics.readWindow(5115, 5118).retentionComplete).toBe(true);
  } finally { f.dispose(); }
});
