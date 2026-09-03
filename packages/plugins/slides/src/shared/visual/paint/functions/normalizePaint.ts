import {
  failure,
  normalizeFillColor,
  normalizeOpaqueColor,
  success,
  type NormalizeResult,
} from '../../colorPrimitives';
import type {
  GradientPaint,
  GradientStop,
  LinearGradientPaint,
  NormalizedPaintPoint,
  NormalizedPaintRadius,
  Paint,
  ShapeFillInput,
  SolidPaint,
  StrokePaint,
} from '../definitions/paint';

const DEFAULT_RADIAL_CENTER: NormalizedPaintPoint = { x: 0.5, y: 0.5 };
const DEFAULT_RADIAL_RADIUS: NormalizedPaintRadius = { x: 0.5, y: 0.5 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeUnitValue(value: unknown, path: string): NormalizeResult<number> {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    return failure(`${path} 必须是 0 到 1 之间的有限数字。`);
  }
  return success(value);
}

function normalizePositiveUnitValue(value: unknown, path: string): NormalizeResult<number> {
  if (!isFiniteNumber(value) || value <= 0 || value > 1) {
    return failure(`${path} 必须是大于 0 且不超过 1 的有限数字。`);
  }
  return success(value);
}

function normalizeGradientStop(value: unknown, path: string): NormalizeResult<GradientStop> {
  if (!isRecord(value) || typeof value.color !== 'string' || value.color.trim() === '') {
    return failure(`${path}.color 必须是非空颜色字符串。`);
  }
  const color = normalizeOpaqueColor(value.color, `${path}.color`);
  if ('error' in color) return color;

  const position = normalizeUnitValue(value.position, `${path}.position`);
  if ('error' in position) return position;

  let opacity: number | undefined;
  if (value.opacity != null) {
    const normalizedOpacity = normalizeUnitValue(value.opacity, `${path}.opacity`);
    if ('error' in normalizedOpacity) return normalizedOpacity;
    opacity = normalizedOpacity.value;
  }

  return success({
    color: color.value,
    position: position.value,
    ...(opacity == null ? {} : { opacity }),
  });
}

function normalizeGradientStops(value: unknown, path: string): NormalizeResult<GradientStop[]> {
  if (!Array.isArray(value) || value.length < 2) {
    return failure(`${path} 必须至少包含两个 stop。`);
  }

  const stops: GradientStop[] = [];
  let previousPosition = -1;
  for (let index = 0; index < value.length; index++) {
    const stop = normalizeGradientStop(value[index], `${path}[${index}]`);
    if ('error' in stop) return stop;
    if (stop.value.position < previousPosition) {
      return failure(`${path}[${index}].position 不能小于前一个 stop；请按 position 非递减排列。`);
    }
    stops.push(stop.value);
    previousPosition = stop.value.position;
  }
  return success(stops);
}

function normalizePoint(
  value: unknown,
  fallback: NormalizedPaintPoint,
  path: string,
): NormalizeResult<NormalizedPaintPoint> {
  if (value == null) return success({ ...fallback });
  if (!isRecord(value)) return failure(`${path} 必须是 { x, y } 对象。`);
  const x = normalizeUnitValue(value.x, `${path}.x`);
  if ('error' in x) return x;
  const y = normalizeUnitValue(value.y, `${path}.y`);
  if ('error' in y) return y;
  return success({ x: x.value, y: y.value });
}

function normalizeRadius(
  value: unknown,
  fallback: NormalizedPaintRadius,
  path: string,
): NormalizeResult<NormalizedPaintRadius> {
  if (value == null) return success({ ...fallback });
  if (!isRecord(value)) return failure(`${path} 必须是 { x, y } 对象。`);
  const x = normalizePositiveUnitValue(value.x, `${path}.x`);
  if ('error' in x) return x;
  const y = normalizePositiveUnitValue(value.y, `${path}.y`);
  if ('error' in y) return y;
  return success({ x: x.value, y: y.value });
}

export function normalizeGradientPaint(
  value: unknown,
  path: string,
): NormalizeResult<GradientPaint> {
  if (!isRecord(value)) return failure(`${path} 必须是渐变对象。`);
  const stops = normalizeGradientStops(value.stops, `${path}.stops`);
  if ('error' in stops) return stops;
  if (value.rotateWithShape != null && typeof value.rotateWithShape !== 'boolean') {
    return failure(`${path}.rotateWithShape 必须是 boolean。`);
  }
  const rotateWithShape = value.rotateWithShape ?? true;

  if (value.type === 'linear') {
    if (!isFiniteNumber(value.angle)) {
      return failure(`${path}.angle 必须是有限数字。`);
    }
    return success({
      type: 'linear',
      angle: normalizeGradientAngle(value.angle),
      stops: stops.value,
      rotateWithShape,
    });
  }

  if (value.type === 'radial') {
    const center = normalizePoint(value.center, DEFAULT_RADIAL_CENTER, `${path}.center`);
    if ('error' in center) return center;
    const radius = normalizeRadius(value.radius, DEFAULT_RADIAL_RADIUS, `${path}.radius`);
    if ('error' in radius) return radius;
    return success({
      type: 'radial',
      stops: stops.value,
      center: center.value,
      radius: radius.value,
      rotateWithShape,
    });
  }

  return failure(`${path}.type 必须是 linear 或 radial。`);
}

export function normalizePaint(value: unknown, path: string): NormalizeResult<Paint> {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return failure(`${path} 必须是合法 Paint 对象。`);
  }
  if (value.type === 'none') return success({ type: 'none' });
  if (value.type === 'solid') {
    if (typeof value.color !== 'string' || value.color.trim() === '') {
      return failure(`${path}.color 必须是非空颜色字符串。`);
    }
    const fill = normalizeFillColor(
      value.color,
      `${path}.color`,
      isFiniteNumber(value.opacity) ? value.opacity : undefined,
    );
    if ('error' in fill) return fill;
    if (value.opacity != null && !isFiniteNumber(value.opacity)) {
      return failure(`${path}.opacity 必须是 0 到 1 之间的有限数字。`);
    }
    if (fill.value.opacity != null && (fill.value.opacity < 0 || fill.value.opacity > 1)) {
      return failure(`${path}.opacity 必须是 0 到 1 之间的有限数字。`);
    }
    return success({
      type: 'solid',
      color: fill.value.color,
      ...(fill.value.opacity == null ? {} : { opacity: fill.value.opacity }),
    });
  }
  return normalizeGradientPaint(value, path);
}

export function normalizeStrokePaint(value: unknown, path: string): NormalizeResult<StrokePaint> {
  const paint = normalizePaint(value, path);
  if ('error' in paint) return paint;
  if (paint.value.type === 'radial') {
    return failure(`${path} 暂不支持 radial stroke；请使用 linear gradient。`);
  }
  return success(paint.value);
}

export function normalizeShapeFillInput(
  value: ShapeFillInput | unknown,
  path: string,
): NormalizeResult<Paint> {
  if (typeof value === 'string') {
    const fill = normalizeFillColor(value, path);
    if ('error' in fill) return fill;
    return success({
      type: 'solid',
      color: fill.value.color,
      ...(fill.value.opacity == null ? {} : { opacity: fill.value.opacity }),
    });
  }
  if (isRecord(value) && typeof value.color === 'string' && value.type == null) {
    if (value.transparency != null && !isFiniteNumber(value.transparency)) {
      return failure(`${path}.transparency 必须是 0 到 100 之间的有限数字。`);
    }
    if (isFiniteNumber(value.transparency) && (value.transparency < 0 || value.transparency > 100)) {
      return failure(`${path}.transparency 必须是 0 到 100 之间的有限数字。`);
    }
    const color = normalizeOpaqueColor(value.color, `${path}.color`);
    if ('error' in color) return color;
    const opacity = isFiniteNumber(value.transparency)
      ? Math.round((1 - value.transparency / 100) * 1_000_000) / 1_000_000
      : undefined;
    const paint: SolidPaint = {
      type: 'solid',
      color: color.value,
      ...(opacity == null ? {} : { opacity }),
    };
    return success(paint);
  }
  return normalizeGradientPaint(value, path);
}

export function normalizeGradientAngle(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function resolvePaintOpacity(paint: Paint, nodeOpacity?: number): number | undefined {
  const ownOpacity = paint.type === 'solid' ? paint.opacity : undefined;
  if (ownOpacity == null) return nodeOpacity;
  if (nodeOpacity == null) return ownOpacity;
  return ownOpacity * nodeOpacity;
}

export function asLinearGradientPaint(paint: GradientPaint): LinearGradientPaint | null {
  return paint.type === 'linear' ? paint : null;
}
