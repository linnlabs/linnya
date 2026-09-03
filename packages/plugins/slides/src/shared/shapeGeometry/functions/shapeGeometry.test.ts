import { describe, expect, it } from 'vitest';
import {
  parseShapeGeometrySpec,
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

  it('首期拒绝多个闭合子路径，避免 hole/fill rule 跨端漂移', () => {
    expect(() => resolveShapeGeometry({
      type: 'path',
      viewBox: { width: 10, height: 10 },
      commands: [
        { type: 'moveTo', x: 0, y: 0 },
        { type: 'lineTo', x: 10, y: 0 },
        { type: 'close' },
        { type: 'moveTo', x: 2, y: 2 },
        { type: 'lineTo', x: 8, y: 2 },
        { type: 'close' },
      ],
    })).toThrow('只支持一个闭合子路径');
  });
});
