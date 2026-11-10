// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasElement } from '@plugin/canvas/shared';
import { parseCanvasViewMemory, rememberCanvasView } from '../functions/canvasViewMemory';
import { resolveCanvasOpeningCamera } from '../functions/resolveCanvasOpeningCamera';
import { createCanvasViewMemory } from '../orchestration/createCanvasViewMemory';

const card = (x: number, y: number) => ({ type: 'text', x, y, width: 400, height: 200 }) as unknown as CanvasElement;
const edge = { type: 'edge' } as unknown as CanvasElement;

describe('打开画布时的视口', () => {
  it('第一次打开把远离原点的全部卡片放进视口，连线不参与计算', () => {
    const camera = resolveCanvasOpeningCamera(null, [card(1040, 0), card(3700, 3800), edge], { width: 660, height: 864 });
    expect(camera).not.toBeNull();
    const zoom = camera!.zoom;
    // 左上角卡片与右下角卡片都落在视口内。
    expect(1040 * zoom + camera!.x).toBeGreaterThanOrEqual(0);
    expect((3700 + 400) * zoom + camera!.x).toBeLessThanOrEqual(660);
    expect((3800 + 200) * zoom + camera!.y).toBeLessThanOrEqual(864);
  });

  it('本机记得上次视口时直接回到那里；空画布或视口未布局时保持默认', () => {
    const remembered = { x: -900, y: -300, zoom: 0.8 };
    expect(resolveCanvasOpeningCamera(remembered, [card(1040, 0)], { width: 660, height: 864 })).toBe(remembered);
    expect(resolveCanvasOpeningCamera(null, [edge], { width: 660, height: 864 })).toBeNull();
    expect(resolveCanvasOpeningCamera(null, [card(1040, 0)], { width: 0, height: 0 })).toBeNull();
  });
});

describe('视口记忆', () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('坏记录当作没有，超过上限丢弃最久没打开的', () => {
    expect(parseCanvasViewMemory('not json')).toEqual({});
    expect(parseCanvasViewMemory(JSON.stringify({ a: { camera: { x: 1, y: 2, zoom: 0 }, at: 1 }, b: { camera: { x: 1, y: 2, zoom: 1 }, at: 2 } })))
      .toEqual({ b: { camera: { x: 1, y: 2, zoom: 1 }, at: 2 } });
    let memory = {};
    for (let index = 0; index < 4; index++) memory = rememberCanvasView(memory, `d${index}`, { x: index, y: 0, zoom: 1 }, index, 3);
    expect(Object.keys(memory).sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('连续平移合并为一次写入，关闭时立即写入最后位置，各文档互不影响', () => {
    vi.useFakeTimers();
    const first = createCanvasViewMemory('doc-a');
    first.remember({ x: 1, y: 1, zoom: 1 });
    first.remember({ x: 2, y: 2, zoom: 1 });
    expect(first.read()).toBeNull();
    vi.advanceTimersByTime(500);
    expect(first.read()).toEqual({ x: 2, y: 2, zoom: 1 });
    first.remember({ x: 3, y: 3, zoom: 0.5 });
    first.flush();
    expect(createCanvasViewMemory('doc-a').read()).toEqual({ x: 3, y: 3, zoom: 0.5 });
    expect(createCanvasViewMemory('doc-b').read()).toBeNull();
  });
});
