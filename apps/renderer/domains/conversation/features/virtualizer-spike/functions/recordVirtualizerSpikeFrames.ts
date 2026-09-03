import type { VirtualizerSpikeFrameSample } from '../definitions/virtualizerSpike';

export function waitForVirtualizerSpikeFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export async function waitForVirtualizerSpikeFrames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await waitForVirtualizerSpikeFrame();
  }
}

export function waitForVirtualizerSpikePaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }

  // 第一个 rAF 后浏览器才会执行 layout/ResizeObserver/paint；第二个 rAF
  // 读取的是上一帧真实绘制结果，避免把 paint 前的内部过渡态误判为闪帧。
  return new Promise(resolve => requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve());
  }));
}

export async function recordVirtualizerSpikeFrames(input: {
  readonly frameCount: number;
  readonly readValue: () => number | null;
}): Promise<VirtualizerSpikeFrameSample[]> {
  const samples: VirtualizerSpikeFrameSample[] = [];
  for (let frame = 0; frame < input.frameCount; frame += 1) {
    await waitForVirtualizerSpikePaint();
    samples.push({ frame, value: input.readValue() });
  }
  return samples;
}
