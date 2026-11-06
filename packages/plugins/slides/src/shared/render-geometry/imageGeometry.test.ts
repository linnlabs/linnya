import { describe, expect, it } from 'vitest';
import { hasImageCrop, resolveImageCropRegion, resolveImageFitGeometry } from './imageGeometry';

const FULL = { x: 0, y: 0, width: 1, height: 1 };

describe('resolveImageFitGeometry 的裁剪与焦点', () => {
  it('cover 不写焦点时窗口居中，与既有行为一致', () => {
    expect(resolveImageFitGeometry({ naturalWidth: 2000, naturalHeight: 1000, boxWidth: 4, boxHeight: 4, fitMode: 'cover' }))
      .toEqual({ source: { x: 0.25, y: 0, width: 0.5, height: 1 }, destination: FULL });
  });

  it('cover 的取景窗以焦点为中心，到边缘停住', () => {
    const base = { naturalWidth: 2000, naturalHeight: 1000, boxWidth: 4, boxHeight: 4, fitMode: 'cover' as const };
    expect(resolveImageFitGeometry({ ...base, focus: { x: 0.6, y: 0.5 } }).source)
      .toEqual({ x: 0.35, y: 0, width: 0.5, height: 1 });
    expect(resolveImageFitGeometry({ ...base, focus: { x: 0.05, y: 0.5 } }).source.x).toBe(0);
    expect(resolveImageFitGeometry({ ...base, focus: { x: 0.95, y: 0.5 } }).source.x).toBe(0.5);
  });

  it('先裁剪再 cover：剩余区域按盒子比例继续收窄', () => {
    // 原图 1000×1000，裁掉右半与下 1/4 → 500×750；放进 1:1 盒子时从上下各再收 125px。
    const geometry = resolveImageFitGeometry({
      naturalWidth: 1000, naturalHeight: 1000, boxWidth: 3, boxHeight: 3, fitMode: 'cover',
      crop: { top: 0, right: 0.5, bottom: 0.25, left: 0 },
    });
    expect(geometry.destination).toEqual(FULL);
    expect(geometry.source.x).toBe(0);
    expect(geometry.source.width).toBeCloseTo(0.5);
    expect(geometry.source.y).toBeCloseTo(0.125);
    expect(geometry.source.height).toBeCloseTo(0.5);
  });

  it('焦点用原图坐标，落在裁剪区外时贴住裁剪区边缘', () => {
    const geometry = resolveImageFitGeometry({
      naturalWidth: 1000, naturalHeight: 1000, boxWidth: 3, boxHeight: 3, fitMode: 'cover',
      crop: { top: 0, right: 0.5, bottom: 0.25, left: 0 },
      focus: { x: 0.2, y: 0.95 },
    });
    expect(geometry.source.y + geometry.source.height).toBeCloseTo(0.75);
  });

  it('contain 完整显示裁剪区域，按区域比例缩小目标框', () => {
    const geometry = resolveImageFitGeometry({
      naturalWidth: 2000, naturalHeight: 1000, boxWidth: 4, boxHeight: 2, fitMode: 'contain',
      crop: { top: 0, right: 0, bottom: 0, left: 0.5 },
    });
    expect(geometry).toEqual({
      source: { x: 0.5, y: 0, width: 0.5, height: 1 },
      destination: { x: 0.25, y: 0, width: 0.5, height: 1 },
    });
  });

  it('stretch 让裁剪区域撑满盒子；尺寸未知时也保留裁剪', () => {
    const crop = { top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 };
    const expectRegion = (source: { x: number; y: number; width: number; height: number }) => {
      expect(source.x).toBeCloseTo(0.4);
      expect(source.y).toBeCloseTo(0.1);
      expect(source.width).toBeCloseTo(0.4);
      expect(source.height).toBeCloseTo(0.6);
    };
    expectRegion(resolveImageFitGeometry({ naturalWidth: 100, naturalHeight: 100, boxWidth: 1, boxHeight: 1, fitMode: 'stretch', crop }).source);
    expectRegion(resolveImageFitGeometry({ naturalWidth: 0, naturalHeight: 0, boxWidth: 1, boxHeight: 1, fitMode: 'cover', crop }).source);
  });

  it('无效或全零的裁剪等同于不裁', () => {
    expect(hasImageCrop({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(false);
    expect(hasImageCrop(undefined)).toBe(false);
    expect(resolveImageCropRegion({ top: -0.2, right: Number.NaN, bottom: 0, left: 0 })).toEqual(FULL);
    // 某一轴剩余不足 1% 时只放弃这一轴的裁剪。
    expect(resolveImageCropRegion({ top: 0.1, right: 0.6, bottom: 0, left: 0.6 })).toEqual({ x: 0, y: 0.1, width: 1, height: 0.9 });
  });
});
