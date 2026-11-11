import { describe, expect, it } from 'vitest';
import {
  parseShapeGeometrySpec,
  resolvePresetShapePath,
  resolveShapeGeometry,
  serializeShapePath,
  ShapeGeometryError,
  shapePathToPointArray,
} from '../index';

describe('shapeGeometry 业务合同', () => {
  it('省略 geometry 才默认矩形，显式未知名称必须失败', () => {
    expect(resolveShapeGeometry(undefined)).toEqual({ type: 'preset', name: 'rect' });
    expect(() => parseShapeGeometrySpec('mystery-shape')).toThrow(ShapeGeometryError);
  });

  it('把正五边形解析为稳定的封闭 local-space 路径', () => {
    const geometry = resolveShapeGeometry({ type: 'regularPolygon', sides: 5 });
    expect(geometry.type).toBe('path');
    if (geometry.type !== 'path') return;
    expect(geometry.commands).toHaveLength(6);
    expect(geometry.commands[0]).toEqual({ type: 'moveTo', x: 0.5, y: 0 });
    expect(geometry.commands.at(-1)).toEqual({ type: 'close' });
    expect(shapePathToPointArray(geometry, 200, 100)).toHaveLength(10);
  });

  it('区分等腰梯形、直角梯形和参数化平行四边形', () => {
    const isosceles = resolveShapeGeometry({
      type: 'trapezoid',
      topLeftInset: 0.2,
      topRightInset: 0.2,
    });
    const right = resolveShapeGeometry({
      type: 'trapezoid',
      topLeftInset: 0,
      topRightInset: 0.2,
    });
    const parallelogram = resolveShapeGeometry({
      type: 'parallelogram',
      slant: 0.25,
      direction: 'left',
    });
    expect(isosceles).not.toEqual(right);
    expect(parallelogram).not.toEqual(isosceles);
  });

  it('polygon 拒绝零面积和相邻重复点', () => {
    expect(() => resolveShapeGeometry({
      type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
    })).toThrow('零面积');
    expect(() => resolveShapeGeometry({
      type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }],
    })).toThrow('相邻点重复');
  });

  it('拒绝会放大 raster/OOXML 制品的超大轮廓', () => {
    const points = Array.from({ length: 257 }, (_, index) => ({
      x: 0.5 + 0.5 * Math.cos(2 * Math.PI * index / 257),
      y: 0.5 + 0.5 * Math.sin(2 * Math.PI * index / 257),
    }));
    expect(() => resolveShapeGeometry({ type: 'polygon', points })).toThrow('不能超过 256');
  });

  it('typed path 可包含二次和三次曲线并生成 Konva SVG path', () => {
    const geometry = resolveShapeGeometry({
      type: 'path',
      viewBox: { width: 100, height: 100 },
      commands: [
        { type: 'moveTo', x: 0, y: 100 },
        { type: 'quadraticTo', x1: 25, y1: 0, x: 50, y: 50 },
        { type: 'cubicTo', x1: 65, y1: 80, x2: 80, y2: 10, x: 100, y: 100 },
        { type: 'close' },
      ],
    });
    expect(geometry.type).toBe('path');
    if (geometry.type !== 'path') return;
    expect(shapePathToPointArray(geometry, 200, 100)).toBeUndefined();
    expect(serializeShapePath(geometry, 200, 100)).toBe(
      'M 0 100 Q 50 0 100 50 C 130 80 160 10 200 100 Z',
    );
  });

  it('把未写 close 的 typed path 保留为开放连线', () => {
    const geometry = resolveShapeGeometry({
      type: 'path',
      viewBox: { width: 100, height: 100 },
      commands: [
        { type: 'moveTo', x: 0, y: 100 },
        { type: 'quadraticTo', x1: 50, y1: 0, x: 100, y: 100 },
      ],
    });

    expect(geometry).toMatchObject({ type: 'path', closed: false });
    if (geometry.type !== 'path') return;
    expect(serializeShapePath(geometry, 200, 100)).toBe('M 0 100 Q 100 0 200 100');
  });

  it('多个闭合子路径可用（镂空、分离笔画），不再走 Line 点阵', () => {
    const geometry = resolveShapeGeometry({
      type: 'path',
      viewBox: { width: 10, height: 10 },
      commands: [
        { type: 'moveTo', x: 0, y: 0 },
        { type: 'lineTo', x: 10, y: 0 },
        { type: 'lineTo', x: 10, y: 10 },
        { type: 'close' },
        { type: 'moveTo', x: 2, y: 2 },
        { type: 'lineTo', x: 8, y: 2 },
        { type: 'lineTo', x: 8, y: 8 },
        { type: 'close' },
      ],
    });
    expect(geometry.type === 'path' && geometry.closed).toBe(true);
    if (geometry.type !== 'path') return;
    expect(shapePathToPointArray(geometry, 100, 100)).toBeUndefined();
  });

  it('多个子路径时，没闭合的那段直接报错', () => {
    expect(() => resolveShapeGeometry({
      type: 'path',
      viewBox: { width: 10, height: 10 },
      commands: [
        { type: 'moveTo', x: 0, y: 0 },
        { type: 'lineTo', x: 10, y: 0 },
        { type: 'moveTo', x: 2, y: 2 },
        { type: 'lineTo', x: 8, y: 2 },
        { type: 'close' },
      ],
    })).toThrow('每一段都要闭合');
  });

  describe('预设展开与 PowerPoint 默认调节值一致（2026-11-11 导出 PDF 核对）', () => {
    const round = (value: number) => Math.round(value * 1000) / 1000 + 0;
    function points(name: Parameters<typeof resolvePresetShapePath>[0], width: number, height: number) {
      const path = resolvePresetShapePath(name, width, height);
      expect(path?.viewBox).toEqual({ width, height });
      // OOXML 的 vf 等系数是五位整数，结果与理想值差 1e-6 量级，比较时取三位小数。
      return path!.commands.flatMap((command) => 'x' in command ? [[round(command.x), round(command.y)]] : []);
    }

    it('hexagon 平顶、左右两尖，内缩按短边 0.25', () => {
      expect(points('hexagon', 10, 6)).toEqual([[0, 3], [1.5, 0], [8.5, 0], [10, 3], [8.5, 6], [1.5, 6]]);
      expect(points('hexagon', 5, 10)).toEqual([[0, 5], [1.25, 0], [3.75, 0], [5, 5], [3.75, 10], [1.25, 10]]);
    });

    it('callout 的尾尖伸到盒子下方 h/8', () => {
      const tail = points('callout', 12, 8).find(([, y]) => y > 8);
      expect(tail?.[0]).toBeCloseTo(3.5);
      expect(tail?.[1]).toBeCloseTo(9);
    });

    it('斜边、箭头按短边算：宽盒子里的 chevron 尖深 0.5·ss，trapezoid 与 nonIsoscelesTrapezoid 默认相同', () => {
      expect(points('chevron', 10, 6)).toEqual([[0, 0], [7, 0], [10, 3], [7, 6], [0, 6], [3, 3]]);
      expect(points('rightArrow', 10, 6)[1]).toEqual([7, 1.5]);
      expect(points('parallelogram', 10, 6)).toEqual([[0, 6], [1.5, 0], [10, 0], [8.5, 6]]);
      expect(points('nonIsoscelesTrapezoid', 10, 6)).toEqual(points('trapezoid', 10, 6));
    });

    it('pentagon 与 star5 拉满外框', () => {
      const pentagon = points('pentagon', 10, 6);
      expect(Math.min(...pentagon.map(([x]) => x))).toBeCloseTo(0, 3);
      expect(Math.max(...pentagon.map(([x]) => x))).toBeCloseTo(10, 3);
      expect(Math.max(...pentagon.map(([, y]) => y))).toBeCloseTo(6, 3);
      const star = points('star5', 10, 6);
      expect(Math.max(...star.map(([x]) => x))).toBeCloseTo(10, 2);
      expect(Math.max(...star.map(([, y]) => y))).toBeCloseTo(6, 2);
    });
  });
});
