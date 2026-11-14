import type { ImageRenderNode, RenderFill } from '../../../types/render';
import { resolveImageFitGeometry } from '@plugin/slides/shared/render-geometry';

export interface KonvaPoint {
  x: number;
  y: number;
}

export interface KonvaShapeFillConfig {
  fill?: string;
  fillLinearGradientStartPoint?: KonvaPoint;
  fillLinearGradientEndPoint?: KonvaPoint;
  fillLinearGradientColorStops?: Array<number | string>;
  fillRadialGradientStartPoint?: KonvaPoint;
  fillRadialGradientEndPoint?: KonvaPoint;
  fillRadialGradientStartRadius?: number;
  fillRadialGradientEndRadius?: number;
  fillRadialGradientColorStops?: Array<number | string>;
}

export interface KonvaShapeStrokeConfig {
  stroke?: string;
  strokeLinearGradientStartPoint?: KonvaPoint;
  strokeLinearGradientEndPoint?: KonvaPoint;
  strokeLinearGradientColorStops?: Array<number | string>;
}

/**
 * Konva 预览层同时消费 render-model 和局部编辑/测试入口。
 * render-model 会把 DSL 的 crop 归一成 cover，但这里仍显式保留 crop 同义值，
 * 防止未来工具链旁路调用时出现预览/编辑语义分叉。
 */
export type KonvaImageFitMode = NonNullable<ImageRenderNode['fitMode']> | 'crop';

export interface KonvaImageFitInput {
  naturalWidth: number;
  naturalHeight: number;
  boxWidth: number;
  boxHeight: number;
  fitMode?: KonvaImageFitMode;
  crop?: ImageRenderNode['crop'];
  focus?: ImageRenderNode['focus'];
}

export interface KonvaImageFitConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export function resolveKonvaShapeFillConfig(
  fill: RenderFill | undefined,
  width: number,
  height: number,
  fillOpacity?: number,
  origin: KonvaPoint = { x: 0, y: 0 },
): KonvaShapeFillConfig {
  if (!fill || fill.type === 'none') {
    return {};
  }

  if (fill.type === 'solid') {
    return { fill: applyColorOpacity(fill.color, combineOpacity(fill.opacity, fillOpacity)) };
  }

  const colorStops = fill.stops.flatMap((stop) => [
    stop.position,
    applyColorOpacity(stop.color, combineOpacity(stop.opacity, fillOpacity)),
  ]);

  if (fill.type === 'radial') {
    throw new Error('Radial Paint requires the shared elliptical scene renderer');
  }

  // 0° 向右、90° 向下、顺时针测量；OOXML adapter 必须复用同一角度合同（scaled="1"）。
  const axis = resolveLinearGradientAxis(fill.angle, width, height);

  return {
    fillLinearGradientStartPoint: { x: axis.start.x + origin.x, y: axis.start.y + origin.y },
    fillLinearGradientEndPoint: { x: axis.end.x + origin.x, y: axis.end.y + origin.y },
    fillLinearGradientColorStops: colorStops,
  };
}

export function resolveKonvaShapeStrokeConfig(
  stroke: RenderFill | undefined,
  width: number,
  height: number,
  origin: KonvaPoint = { x: 0, y: 0 },
): KonvaShapeStrokeConfig {
  if (!stroke || stroke.type === 'none' || stroke.type === 'radial') return {};
  if (stroke.type === 'solid') {
    return { stroke: applyColorOpacity(stroke.color, stroke.opacity) };
  }

  const axis = resolveLinearGradientAxis(stroke.angle, width, height);
  return {
    strokeLinearGradientStartPoint: { x: axis.start.x + origin.x, y: axis.start.y + origin.y },
    strokeLinearGradientEndPoint: { x: axis.end.x + origin.x, y: axis.end.y + origin.y },
    strokeLinearGradientColorStops: stroke.stops.flatMap((stop) => [
      stop.position,
      applyColorOpacity(stop.color, stop.opacity),
    ]),
  };
}

/**
 * 与导出写的 `a:lin scaled="1"` 一致：角度定义在单位正方形里，再随盒子拉伸。
 * 于是 45° 在 2:1 的盒子里等值线沿另一条对角线，而不是在像素空间里与 45° 方向垂直。
 * 单位正方形里 f(q) = (q - ½)·u / (|cos|+|sin|) + ½；映射回像素后梯度为
 * g = (cos/w, sin/h) / (|cos|+|sin|)，Konva 端点取 center ± g/|g|²/2。
 */
function resolveLinearGradientAxis(
  angle: number,
  width: number,
  height: number,
): { start: KonvaPoint; end: KonvaPoint } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const extent = Math.abs(cos) + Math.abs(sin);
  const center = { x: width / 2, y: height / 2 };
  const gx = width > 0 ? cos / width / extent : 0;
  const gy = height > 0 ? sin / height / extent : 0;
  const length = gx * gx + gy * gy;
  if (length <= 0) return { start: { x: 0, y: round3(center.y) }, end: { x: round3(width), y: round3(center.y) } };
  const halfX = gx / length / 2;
  const halfY = gy / length / 2;
  // `+ 0` 把 round3 产生的 -0 规整成 0。
  return {
    start: { x: round3(center.x - halfX) + 0, y: round3(center.y - halfY) + 0 },
    end: { x: round3(center.x + halfX) + 0, y: round3(center.y + halfY) + 0 },
  };
}

function applyColorOpacity(color: string, opacity: number | undefined): string {
  if (opacity == null || opacity >= 1) return color;
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return color;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${round3(opacity)})`;
}

function combineOpacity(own: number | undefined, parent: number | undefined): number | undefined {
  if (own == null) return parent;
  if (parent == null) return own;
  return own * parent;
}

export function resolveKonvaImageFitConfig(input: KonvaImageFitInput): KonvaImageFitConfig {
  const {
    naturalWidth,
    naturalHeight,
    boxWidth,
    boxHeight,
    fitMode,
  } = input;

  if (naturalWidth <= 0 || naturalHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }

  const geometry = resolveImageFitGeometry({
    naturalWidth,
    naturalHeight,
    boxWidth,
    boxHeight,
    fitMode,
    crop: input.crop,
    focus: input.focus,
  });
  const destination = geometry.destination;
  const source = geometry.source;
  const config: KonvaImageFitConfig = {
    x: round3(destination.x * boxWidth),
    y: round3(destination.y * boxHeight),
    width: round3(destination.width * boxWidth),
    height: round3(destination.height * boxHeight),
  };
  if (
    source.x !== 0
    || source.y !== 0
    || source.width !== 1
    || source.height !== 1
  ) {
    config.crop = {
      x: round3(source.x * naturalWidth),
      y: round3(source.y * naturalHeight),
      width: round3(source.width * naturalWidth),
      height: round3(source.height * naturalHeight),
    };
  }
  return config;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
