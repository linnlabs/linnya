import type { ResolvedShapeGeometry, ShapeGeometrySpec } from './shapeGeometry';

/**
 * 图片遮罩的写法：`"rect"` 与不写一样（不遮罩），`"circle"` 是椭圆的旧写法，
 * 其余与 Shape `geometry` 完全相同。遮罩套在图片实际画面框上（contain 时是缩小后的框）。
 */
export type ImageMaskShapeSpec = 'rect' | 'circle' | ShapeGeometrySpec;

/** RenderModel 里的图片遮罩：旧数据仍可能是 `"rect"` / `"circle"`，新数据是规范化几何。 */
export type RenderImageMaskShape = 'rect' | 'circle' | ResolvedShapeGeometry;
