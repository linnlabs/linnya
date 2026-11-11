import type { ImageVisualShadow, ShapeStyle } from '../deckSpec';

/**
 * deck.js 的阴影写法（图片、Shape、View 共用）：`angle` 是度，0° 向右、顺时针增大（90° 向下），
 * 与 PowerPoint 的阴影方向一致；`distance` 与 `blur` 都是 pt。没写的字段取下面的默认。
 * DeckSpec 的 ShapeStyle.shadow 与 RenderModel 用直角坐标偏移，这里是唯一换算处。
 */
export function resolveVisualShadowOffset(shadow: ImageVisualShadow): NonNullable<ShapeStyle['shadow']> {
  const angle = ((shadow.angle ?? 45) * Math.PI) / 180;
  const distance = shadow.distance ?? 0;
  return {
    color: shadow.color ?? '#000000',
    blur: shadow.blur ?? 0,
    offsetX: Math.cos(angle) * distance,
    offsetY: Math.sin(angle) * distance,
    ...(shadow.opacity != null ? { opacity: shadow.opacity } : {}),
  };
}
