/** 渐变色标。position/opacity 都使用 0..1 归一化范围。 */
export interface GradientStop {
  color: string;
  position: number;
  opacity?: number;
}

export interface NormalizedPaintPoint {
  x: number;
  y: number;
}

export interface NormalizedPaintRadius {
  x: number;
  y: number;
}

/** 0° 向右、90° 向下，顺时针测量。 */
export interface LinearGradientPaint {
  type: 'linear';
  angle: number;
  stops: GradientStop[];
  /** 默认 true；决定渐变是否随形状旋转。 */
  rotateWithShape?: boolean;
}

/**
 * 径向渐变使用元素边界框内的归一化椭圆定义。
 * center 默认 (0.5, 0.5)，radius 默认 (0.5, 0.5)。
 */
export interface RadialGradientPaint {
  type: 'radial';
  stops: GradientStop[];
  center?: NormalizedPaintPoint;
  radius?: NormalizedPaintRadius;
  /** 默认 true；决定渐变是否随形状旋转。 */
  rotateWithShape?: boolean;
}

export type GradientPaint = LinearGradientPaint | RadialGradientPaint;

export interface SolidPaint {
  type: 'solid';
  color: string;
  opacity?: number;
}

export interface NoPaint {
  type: 'none';
}

/** Slides 内部统一的二维视觉填充合同。 */
export type Paint = NoPaint | SolidPaint | GradientPaint;

/** Konva 与当前 Office 兼容基线只公开 linear stroke。 */
export type StrokePaint = NoPaint | SolidPaint | LinearGradientPaint;

/** deck.js shape.fill 的兼容输入；进入 DeckSpec 前必须归一化为 Paint。 */
export type ShapeFillInput =
  | string
  | { color: string; transparency?: number }
  | GradientPaint;

export interface ShapeStrokeStyle {
  width: number;
  dash?: 'solid' | 'dash' | 'dot';
  /** 当前合同；与 legacy color 互斥。 */
  paint?: StrokePaint;
  /** @deprecated 仅供旧 DeckSpec admission；新 deck.js 纯色仍可使用 border.color。 */
  color?: string;
}

