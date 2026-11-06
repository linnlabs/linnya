import { describe, expect, it } from 'vitest';
import { readImageCropInput, readImageFocusInput } from './imageFraming';

describe('图片取景的作者输入', () => {
  it('省略的边按 0，全零等同于不裁', () => {
    expect(readImageCropInput({ left: 0.2, bottom: 0.1 }, 'Image.crop'))
      .toEqual({ value: { top: 0, right: 0, bottom: 0.1, left: 0.2 } });
    expect(readImageCropInput({ top: 0 }, 'Image.crop')).toEqual({ value: undefined });
  });

  it.each([
    [{ x: 0.2 }, 'Image.crop 写成 { top, right, bottom, left }'],
    [{ left: 1 }, 'Image.crop.left 必须是 0–1 之间的比例'],
    [{ top: -0.1 }, 'Image.crop.top 必须是 0–1 之间的比例'],
    [{ left: '0.2' }, 'Image.crop.left 必须是 0–1 之间的比例'],
    [{ left: 0.6, right: 0.4 }, 'Image.crop.left 与 Image.crop.right 相加必须小于 0.99'],
    [{ top: 0.5, bottom: 0.5 }, 'Image.crop.top 与 Image.crop.bottom 相加必须小于 0.99'],
    ['0.2', 'Image.crop 写成 { top, right, bottom, left }'],
  ])('拒绝 %j 并说明写法', (value, message) => {
    const result = readImageCropInput(value, 'Image.crop');
    expect('error' in result && result.error).toContain(message);
  });

  it('焦点只接受 0–1 的 x、y', () => {
    expect(readImageFocusInput({ x: 0.3, y: 0.8 }, 'Image.focus')).toEqual({ value: { x: 0.3, y: 0.8 } });
    for (const value of [{ x: 1.2, y: 0.5 }, { x: 0.5 }, { x: 0.5, y: 0.5, z: 1 }, [0.5, 0.5]]) {
      const result = readImageFocusInput(value, 'Image.focus');
      expect('error' in result && result.error).toContain('Image.focus 写成 { x, y }');
    }
  });
});
