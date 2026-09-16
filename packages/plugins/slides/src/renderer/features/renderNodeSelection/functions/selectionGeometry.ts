import type {
  RenderNodeSelectionPoint,
  RenderNodeSelectionRect,
} from '../definitions/renderNodeSelectionTypes';

export interface RenderNodeSelectionMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const IDENTITY_MATRIX: RenderNodeSelectionMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function identityMatrix(): RenderNodeSelectionMatrix {
  return IDENTITY_MATRIX;
}

export function multiplyMatrix(
  left: RenderNodeSelectionMatrix,
  right: RenderNodeSelectionMatrix,
): RenderNodeSelectionMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function translateMatrix(x: number, y: number): RenderNodeSelectionMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function rotateMatrix(degrees: number): RenderNodeSelectionMatrix {
  if (degrees === 0) return IDENTITY_MATRIX;
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function invertMatrix(matrix: RenderNodeSelectionMatrix): RenderNodeSelectionMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) <= Number.EPSILON) return null;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

export function applyMatrix(
  matrix: RenderNodeSelectionMatrix,
  point: RenderNodeSelectionPoint,
): RenderNodeSelectionPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function normalizeRect(rect: RenderNodeSelectionRect): RenderNodeSelectionRect {
  const x1 = Math.min(rect.x, rect.x + rect.w);
  const y1 = Math.min(rect.y, rect.y + rect.h);
  const x2 = Math.max(rect.x, rect.x + rect.w);
  const y2 = Math.max(rect.y, rect.y + rect.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function rectFromPoints(
  anchor: RenderNodeSelectionPoint,
  focus: RenderNodeSelectionPoint,
): RenderNodeSelectionRect {
  return normalizeRect({
    x: anchor.x,
    y: anchor.y,
    w: focus.x - anchor.x,
    h: focus.y - anchor.y,
  });
}

export function rectToPolygon(
  rect: RenderNodeSelectionRect,
): readonly RenderNodeSelectionPoint[] {
  const normalized = normalizeRect(rect);
  return [
    { x: normalized.x, y: normalized.y },
    { x: normalized.x + normalized.w, y: normalized.y },
    { x: normalized.x + normalized.w, y: normalized.y + normalized.h },
    { x: normalized.x, y: normalized.y + normalized.h },
  ];
}

export function polygonBounds(points: readonly RenderNodeSelectionPoint[]): RenderNodeSelectionRect {
  const first = points[0];
  if (!first) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(
  left: RenderNodeSelectionRect,
  right: RenderNodeSelectionRect,
): boolean {
  const a = normalizeRect(left);
  const b = normalizeRect(right);
  return a.x <= b.x + b.w
    && a.x + a.w >= b.x
    && a.y <= b.y + b.h
    && a.y + a.h >= b.y;
}

export function pointInRect(
  point: RenderNodeSelectionPoint,
  rect: RenderNodeSelectionRect,
): boolean {
  return point.x >= rect.x
    && point.x <= rect.x + rect.w
    && point.y >= rect.y
    && point.y <= rect.y + rect.h;
}
