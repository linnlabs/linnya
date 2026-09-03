import type PptxGenJS from 'pptxgenjs';
import {
  resolveShapeGeometry,
  type ResolvedPathShapeGeometry,
  type ShapeGeometrySpec,
} from '@plugin/slides/shared';
import type { Box } from '@plugin/slides/shared';
import { presetShapeNameToPptxName } from './shapeNameRegistry';

type PptxCustomPoint = NonNullable<PptxGenJS.ShapeProps['points']>[number];

export interface PptxShapeGeometry {
  readonly shapeName: PptxGenJS.SHAPE_NAME | 'custGeom';
  readonly points?: NonNullable<PptxGenJS.ShapeProps['points']>;
}

export function addPptxShapeText(
  slide: PptxGenJS.Slide,
  text: string,
  geometry: PptxShapeGeometry,
  options: Omit<PptxGenJS.TextPropsOptions, 'shape'>,
): void {
  if (geometry.shapeName === 'custGeom') {
    if (!geometry.points) {
      throw new Error('custGeom 必须携带 points。');
    }
    invokePptxMethod(slide, 'addText', [text, {
      ...options,
      shape: 'custGeom',
      points: geometry.points,
    }]);
    return;
  }
  slide.addText(text, { ...options, shape: geometry.shapeName });
}

export function addPptxCustomGeometryShape(
  slide: PptxGenJS.Slide,
  options: PptxGenJS.ShapeProps,
): void {
  invokePptxMethod(slide, 'addShape', ['custGeom', options]);
}

/**
 * PptxGenJS 4.0.1 runtime 已实现 custGeom，但声明文件遗漏该 shape 名。
 * 反射只存在于这个窄 adapter，且由 OOXML artifact test 验证真实行为。
 */
function invokePptxMethod(
  slide: PptxGenJS.Slide,
  methodName: 'addShape' | 'addText',
  args: readonly unknown[],
): void {
  const method: unknown = Reflect.get(slide, methodName);
  if (typeof method !== 'function') {
    throw new Error(`PptxGenJS Slide 缺少 ${methodName} 方法。`);
  }
  Reflect.apply(method, slide, args);
}

/** 把领域几何 lowering 为 PptxGenJS 的 preset 或 custGeom。 */
export function resolvePptxShapeGeometry(
  input: ShapeGeometrySpec | undefined,
  box: Box,
): PptxShapeGeometry {
  const geometry = resolveShapeGeometry(input);
  if (geometry.type === 'preset') {
    return { shapeName: presetShapeNameToPptxName(geometry.name) };
  }
  return {
    shapeName: 'custGeom',
    points: toPptxCustomPoints(geometry, box),
  };
}

function toPptxCustomPoints(
  geometry: ResolvedPathShapeGeometry,
  box: Box,
): NonNullable<PptxGenJS.ShapeProps['points']> {
  const scaleX = box.w / geometry.viewBox.width;
  const scaleY = box.h / geometry.viewBox.height;
  return geometry.commands.map((command): PptxCustomPoint => {
    switch (command.type) {
      case 'moveTo':
        return { x: command.x * scaleX, y: command.y * scaleY, moveTo: true };
      case 'lineTo':
        return { x: command.x * scaleX, y: command.y * scaleY };
      case 'quadraticTo':
        return {
          x: command.x * scaleX,
          y: command.y * scaleY,
          curve: {
            type: 'quadratic',
            x1: command.x1 * scaleX,
            y1: command.y1 * scaleY,
          },
        };
      case 'cubicTo':
        return {
          x: command.x * scaleX,
          y: command.y * scaleY,
          curve: {
            type: 'cubic',
            x1: command.x1 * scaleX,
            y1: command.y1 * scaleY,
            x2: command.x2 * scaleX,
            y2: command.y2 * scaleY,
          },
        };
      case 'close':
        return { close: true };
    }
  });
}
