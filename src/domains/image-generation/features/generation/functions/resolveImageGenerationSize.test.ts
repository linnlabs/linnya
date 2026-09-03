import { describe, expect, it } from 'vitest';
import { resolveImageGenerationSize } from './resolveImageGenerationSize';

describe('resolveImageGenerationSize', () => {
  const constraints = {
    min_pixels: 3_686_400,
    max_pixels: 16_777_216,
    allowed_sizes: ['2K', '2048x2048', '4096x4096'],
  } as const;

  it('接纳目录声明的 Provider 原生尺寸和满足像素约束的 WxH 尺寸', () => {
    expect(resolveImageGenerationSize('2K', constraints)).toBe('2K');
    expect(resolveImageGenerationSize('2048x2048', constraints)).toBe('2048x2048');
  });

  it('请求前拒绝未声明或像素越界的尺寸，不静默替换', () => {
    expect(() => resolveImageGenerationSize('1024x1024', constraints)).toThrow(
      /不在当前模型允许范围/,
    );
    expect(() => resolveImageGenerationSize('5000x5000', {
      max_pixels: 16_777_216,
    })).toThrow(/超过当前模型最大像素数/);
  });
});
