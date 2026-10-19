import { describe, expect, it } from 'vitest';

import {
  SCROLL_GLIDE_MAX_ABSORBED_DELTA_PX,
  SCROLL_GLIDE_MAX_FRAME_MS,
  SCROLL_GLIDE_SETTLE_PX,
  SCROLL_GLIDE_TIME_CONSTANT_MS,
  absorbScrollDelta,
  decayScrollGlideOffset,
  snapToDevicePixel,
} from './streamingScrollGlide';

describe('streamingScrollGlide', () => {
  it('小幅跳变进入偏移并累加', () => {
    expect(absorbScrollDelta(0, 22)).toBe(22);
    expect(absorbScrollDelta(10, 22)).toBe(32);
    expect(absorbScrollDelta(10, -4)).toBe(6);
  });

  it('没有变化或非有限值不改变偏移', () => {
    expect(absorbScrollDelta(7, 0)).toBe(7);
    expect(absorbScrollDelta(7, Number.NaN)).toBe(7);
  });

  it('超过上限的跳变视为结构性滚动：放弃缓动并清零', () => {
    expect(absorbScrollDelta(15, SCROLL_GLIDE_MAX_ABSORBED_DELTA_PX + 1)).toBe(0);
    expect(absorbScrollDelta(15, -(SCROLL_GLIDE_MAX_ABSORBED_DELTA_PX + 1))).toBe(0);
    expect(absorbScrollDelta(15, SCROLL_GLIDE_MAX_ABSORBED_DELTA_PX)).toBe(15 + SCROLL_GLIDE_MAX_ABSORBED_DELTA_PX);
  });

  it('偏移按时间常数指数衰减', () => {
    const next = decayScrollGlideOffset(22, SCROLL_GLIDE_TIME_CONSTANT_MS / 2);
    expect(next).toBeCloseTo(22 * Math.exp(-0.5), 5);
  });

  it('衰减单调且最终落定为 0（正负对称）', () => {
    let offset = 40;
    let negative = -40;
    let previous = offset;
    for (let frame = 0; frame < 120; frame += 1) {
      offset = decayScrollGlideOffset(offset, 16);
      negative = decayScrollGlideOffset(negative, 16);
      expect(offset).toBeLessThanOrEqual(previous);
      previous = offset;
    }
    expect(offset).toBe(0);
    expect(negative).toBe(0);
  });

  it('按设备像素取整，且不产生 -0', () => {
    expect(snapToDevicePixel(0.37, 2)).toBe(0.5);
    expect(snapToDevicePixel(0.2, 2)).toBe(0);
    expect(snapToDevicePixel(-0.2, 2)).toBe(0);
    expect(Object.is(snapToDevicePixel(-0.2, 2), -0)).toBe(false);
    expect(snapToDevicePixel(7.4, 1)).toBe(7);
    expect(snapToDevicePixel(7.4, 3)).toBeCloseTo(7.3333, 3);
    expect(snapToDevicePixel(3.3, 0)).toBe(3);
    expect(snapToDevicePixel(3.3, Number.NaN)).toBe(3);
  });

  it('小于落定阈值直接归零', () => {
    expect(decayScrollGlideOffset(SCROLL_GLIDE_SETTLE_PX * 1.01, 200)).toBe(0);
    expect(decayScrollGlideOffset(0, 16)).toBe(0);
  });

  it('单帧时间被夹住：页面挂起很久后恢复，不会一次衰减到位', () => {
    const afterHang = decayScrollGlideOffset(60, 60_000);
    expect(afterHang).toBeCloseTo(60 * Math.exp(-SCROLL_GLIDE_MAX_FRAME_MS / SCROLL_GLIDE_TIME_CONSTANT_MS), 5);
    expect(decayScrollGlideOffset(60, -5)).toBe(60);
  });
});
