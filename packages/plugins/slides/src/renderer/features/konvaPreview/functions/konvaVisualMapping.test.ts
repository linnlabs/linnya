import { describe, expect, it } from 'vitest';
import {
  resolveKonvaImageFitConfig,
  resolveKonvaShapeFillConfig,
} from './konvaVisualMapping';

describe('konvaVisualMapping', () => {
  it('maps linear gradient fills to Konva gradient config', () => {
    const config = resolveKonvaShapeFillConfig({
      type: 'linear',
      angle: 0,
      stops: [
        { color: '#0F2747', position: 0 },
        { color: '#F97316', position: 1 },
      ],
    }, 300, 120);

    expect(config).toEqual({
      fillLinearGradientStartPoint: { x: 0, y: 60 },
      fillLinearGradientEndPoint: { x: 300, y: 60 },
      fillLinearGradientColorStops: [0, '#0F2747', 1, '#F97316'],
    });
  });

  // ─── 渐变角度方向 · 四端契约（B11） ─────────────────────────────────
  // 锁定 0° 向右、90° 向下、顺时针测量，且渐变线两端贴 bounding box 对侧边缘。
  // 必须与 shared Paint 角度合同 / native OOXML Paint adapter 完全一致。
  describe('linear gradient angle 方向（B11）', () => {
    function gradient(angle: number) {
      return {
        type: 'linear' as const,
        angle,
        stops: [
          { color: '#000000', position: 0 },
          { color: '#FFFFFF', position: 1 },
        ],
      };
    }

    it('angle = 0° 水平向右（贴 box 左右边缘）', () => {
      const c = resolveKonvaShapeFillConfig(gradient(0), 400, 200);
      expect(c.fillLinearGradientStartPoint).toEqual({ x: 0, y: 100 });
      expect(c.fillLinearGradientEndPoint).toEqual({ x: 400, y: 100 });
    });

    it('angle = 90° 垂直向下（贴 box 上下边缘）', () => {
      const c = resolveKonvaShapeFillConfig(gradient(90), 400, 200);
      expect(c.fillLinearGradientStartPoint).toEqual({ x: 200, y: 0 });
      expect(c.fillLinearGradientEndPoint).toEqual({ x: 200, y: 200 });
    });

    it('angle = 180° 水平向左（贴 box 右左边缘）', () => {
      const c = resolveKonvaShapeFillConfig(gradient(180), 400, 200);
      expect(c.fillLinearGradientStartPoint).toEqual({ x: 400, y: 100 });
      expect(c.fillLinearGradientEndPoint).toEqual({ x: 0, y: 100 });
    });

    it('angle = 270° 垂直向上（贴 box 下上边缘）', () => {
      const c = resolveKonvaShapeFillConfig(gradient(270), 400, 200);
      expect(c.fillLinearGradientStartPoint).toEqual({ x: 200, y: 200 });
      expect(c.fillLinearGradientEndPoint).toEqual({ x: 200, y: 0 });
    });

    it('angle = 45° 渐变线贴 box 对角（修复前会短于对角线）', () => {
      const c = resolveKonvaShapeFillConfig(gradient(45), 400, 200);
      // ux=uy=1（max-norm），halfX=200, halfY=100，渐变线 = box 完整对角线
      expect(c.fillLinearGradientStartPoint).toEqual({ x: 0, y: 0 });
      expect(c.fillLinearGradientEndPoint).toEqual({ x: 400, y: 200 });
    });
  });

  it('maps cover image fit to source crop while keeping target box size', () => {
    const config = resolveKonvaImageFitConfig({
      naturalWidth: 1600,
      naturalHeight: 900,
      boxWidth: 300,
      boxHeight: 300,
      fitMode: 'cover',
    });

    expect(config).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      crop: {
        x: 350,
        y: 0,
        width: 900,
        height: 900,
      },
    });
  });

  it('maps contain image fit to centered target dimensions without crop', () => {
    const config = resolveKonvaImageFitConfig({
      naturalWidth: 1600,
      naturalHeight: 900,
      boxWidth: 300,
      boxHeight: 300,
      fitMode: 'contain',
    });

    expect(config).toEqual({
      x: 0,
      y: 65.625,
      width: 300,
      height: 168.75,
    });
  });

  it('treats crop image fit the same as cover', () => {
    const config = resolveKonvaImageFitConfig({
      naturalWidth: 1600,
      naturalHeight: 900,
      boxWidth: 300,
      boxHeight: 300,
      fitMode: 'crop',
    });

    expect(config).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      crop: {
        x: 350,
        y: 0,
        width: 900,
        height: 900,
      },
    });
  });
});
