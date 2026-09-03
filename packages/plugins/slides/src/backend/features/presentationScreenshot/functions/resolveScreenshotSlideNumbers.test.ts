import { describe, expect, it } from 'vitest';
import {
  createScreenshotFileName,
  resolveScreenshotSlideNumbers,
} from './resolveScreenshotSlideNumbers';

describe('resolveScreenshotSlideNumbers', () => {
  it('按 1-based 顺序解析单页、范围和全稿', () => {
    expect(resolveScreenshotSlideNumbers({ kind: 'single', slideNumber: 2 }, 4))
      .toEqual([2]);
    expect(resolveScreenshotSlideNumbers({
      kind: 'range',
      fromSlideNumber: 2,
      toSlideNumber: 4,
    }, 4)).toEqual([2, 3, 4]);
    expect(resolveScreenshotSlideNumbers({ kind: 'all' }, 4))
      .toEqual([1, 2, 3, 4]);
  });

  it('拒绝越界页码和反向范围', () => {
    expect(() => resolveScreenshotSlideNumbers({ kind: 'single', slideNumber: 0 }, 3))
      .toThrow('outside 1-3');
    expect(() => resolveScreenshotSlideNumbers({
      kind: 'range',
      fromSlideNumber: 3,
      toSlideNumber: 2,
    }, 3)).toThrow('must not exceed');
  });

  it('生成与标题无关的稳定文件名', () => {
    expect(createScreenshotFileName(7, { kind: 'lossless_png' })).toBe('slide-007.png');
    expect(createScreenshotFileName(1002, { kind: 'agent_review_jpeg' }))
      .toBe('slide-1002.jpg');
  });
});
