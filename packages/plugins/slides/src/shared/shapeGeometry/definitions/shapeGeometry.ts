/**
 * Slides 形状几何合同。
 *
 * 坐标始终属于 shape local space，不包含 slide 绝对位置；Paint、文字和 transform
 * 由 Shape element 在更高一层组合，不能进入本合同。
 */

/**
 * 内置形状名。
 *
 * 这里写成自足的字面量联合，而不是 `typeof PRESET_SHAPE_NAMES[number]`：
 * 本文件会被 `scripts/codegen/generate-layout-dts.ts` 抽取成 deck.js 的 ambient d.ts，
 * 而抽取器只搬运类型声明、不搬运值声明。派生自 const 的写法会在生成物里留下
 * 悬空的 `typeof PRESET_SHAPE_NAMES`，让 sandbox typecheck 失效。
 */
export type PresetShapeName =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'rightTriangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star5'
  | 'rightArrow'
  | 'line'
  | 'callout'
  | 'parallelogram'
  | 'trapezoid'
  | 'nonIsoscelesTrapezoid'
  | 'chevron';

export const PRESET_SHAPE_NAMES = [
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'rightTriangle',
  'diamond',
  'pentagon',
  'hexagon',
  'star5',
  'rightArrow',
  'line',
  'callout',
  'parallelogram',
  'trapezoid',
  'nonIsoscelesTrapezoid',
  'chevron',
] as const satisfies readonly PresetShapeName[];

/** 编译期断言：联合类型里的每个名字都必须出现在运行时清单中。 */
type AssertEveryPresetListed =
  Exclude<PresetShapeName, typeof PRESET_SHAPE_NAMES[number]> extends never ? true : never;
const _assertEveryPresetListed: AssertEveryPresetListed = true;
void _assertEveryPresetListed;

/** 防止 deck.js 输入制造异常大的 RenderModel、Konva path 与 OOXML。 */
export const MAX_SHAPE_POLYGON_POINTS = 256;
export const MAX_SHAPE_PATH_COMMANDS = 512;

export interface ShapePoint {
  readonly x: number;
  readonly y: number;
}

export interface ShapeViewBox {
  readonly width: number;
  readonly height: number;
}

export type ShapePathCommand =
  | { readonly type: 'moveTo'; readonly x: number; readonly y: number }
  | { readonly type: 'lineTo'; readonly x: number; readonly y: number }
  | {
      readonly type: 'quadraticTo';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'cubicTo';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'close' };

export interface PresetShapeGeometrySpec {
  readonly type: 'preset';
  readonly name: PresetShapeName;
}

export interface RegularPolygonGeometrySpec {
  readonly type: 'regularPolygon';
  readonly sides: number;
  /** degree；默认 -90，让首个顶点朝上。 */
  readonly rotation?: number;
}

export interface TrapezoidGeometrySpec {
  readonly type: 'trapezoid';
  /** 顶边左端相对 shape 宽度的缩进，0..1。 */
  readonly topLeftInset: number;
  /** 顶边右端相对 shape 宽度的缩进，0..1。 */
  readonly topRightInset: number;
}

export interface ParallelogramGeometrySpec {
  readonly type: 'parallelogram';
  /** 倾斜量相对 shape 宽度的比例，0..0.5。 */
  readonly slant: number;
  readonly direction?: 'left' | 'right';
}

export interface PolygonGeometrySpec {
  readonly type: 'polygon';
  /** shape local normalized coordinate，x/y 均为 0..1。 */
  readonly points: readonly ShapePoint[];
}

export interface PathGeometrySpec {
  readonly type: 'path';
  readonly viewBox: ShapeViewBox;
  readonly commands: readonly ShapePathCommand[];
}

/** deck.js / DeckSpec 使用的语义几何。字符串是 preset 的简写。 */
export type ShapeGeometrySpec =
  | PresetShapeName
  | PresetShapeGeometrySpec
  | RegularPolygonGeometrySpec
  | TrapezoidGeometrySpec
  | ParallelogramGeometrySpec
  | PolygonGeometrySpec
  | PathGeometrySpec;

export interface ResolvedPresetShapeGeometry {
  readonly type: 'preset';
  readonly name: PresetShapeName;
}

export interface ResolvedPathShapeGeometry {
  readonly type: 'path';
  readonly viewBox: ShapeViewBox;
  readonly commands: readonly ShapePathCommand[];
  readonly closed: boolean;
}

/** compiler、RenderModel 与 renderer 共同消费的规范化几何。 */
export type ResolvedShapeGeometry =
  | ResolvedPresetShapeGeometry
  | ResolvedPathShapeGeometry;

export const DEFAULT_SHAPE_GEOMETRY: ResolvedPresetShapeGeometry = Object.freeze({
  type: 'preset',
  name: 'rect',
});
