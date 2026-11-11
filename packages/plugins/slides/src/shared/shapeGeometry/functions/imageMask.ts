import type { ImageMaskShapeSpec, RenderImageMaskShape } from '../definitions/imageMask';
import type { ResolvedShapeGeometry } from '../definitions/shapeGeometry';
import { parseShapeGeometrySpec, resolveShapeGeometry } from './shapeGeometry';

const ELLIPSE: ResolvedShapeGeometry = { type: 'preset', name: 'ellipse' };

/** raw compose 输入的严格 parser：`rect` / `circle` 之外按 Shape geometry 校验，写错直接报错。 */
export function parseImageMaskShape(value: unknown, fieldPath = 'maskShape'): ImageMaskShapeSpec | undefined {
  if (value == null) return undefined;
  if (value === 'rect' || value === 'circle') return value;
  return parseShapeGeometrySpec(value, fieldPath);
}

/** DeckSpec → RenderModel：`rounding` 是椭圆的旧开关；矩形不算遮罩。 */
export function resolveImageMaskShape(
  mask: ImageMaskShapeSpec | undefined,
  rounding?: boolean,
): RenderImageMaskShape | undefined {
  if (mask === 'circle' || (rounding && (mask == null || mask === 'rect'))) return 'circle';
  if (mask == null || mask === 'rect') return undefined;
  const geometry = resolveShapeGeometry(mask, 'maskShape');
  return isPlainRect(geometry) ? undefined : geometry;
}

/** Renderer 与 PPTX 用的遮罩几何；没有遮罩（含矩形）返回 undefined。 */
export function resolveImageMaskGeometry(
  mask: RenderImageMaskShape | ImageMaskShapeSpec | undefined,
): ResolvedShapeGeometry | undefined {
  if (mask == null || mask === 'rect') return undefined;
  if (mask === 'circle') return ELLIPSE;
  const geometry = resolveShapeGeometry(mask, 'maskShape');
  return isPlainRect(geometry) ? undefined : geometry;
}

function isPlainRect(geometry: ResolvedShapeGeometry): boolean {
  return geometry.type === 'preset' && geometry.name === 'rect';
}
