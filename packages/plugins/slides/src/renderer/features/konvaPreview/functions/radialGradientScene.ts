import type { ShapeConfig } from 'konva/lib/Shape';
import type { RenderFill } from '../../../types/render';

/** 椭圆渐变必须在目标绘制上下文中变换；跨 Canvas 传递 gradient 不保留创建矩阵。 */
export function createRadialGradientScene(
  fill: Extract<RenderFill, { type: 'radial' }>,
  width: number,
  height: number,
  createPath: () => Path2D,
  opacity = 1,
  origin = { x: 0, y: 0 },
): Pick<ShapeConfig, 'sceneFunc' | 'hitFunc' | 'fill'> {
  return {
    // 让 Konva 正确识别填充节点并应用其阴影/命中流程；实际 paint 由 sceneFunc 绘制。
    fill: fill.stops[0]?.color,
    // 命中画布必须写入 Konva 身份色，不能复用视觉渐变颜色。
    hitFunc(context, shape) {
      const native = context._context;
      const path = createPath();
      native.save();
      native.fillStyle = shape.colorKey;
      native.fill(path);
      if (shape.hasStroke() && shape.strokeEnabled()) {
        const hitWidth = shape.hitStrokeWidth();
        native.lineWidth = hitWidth === 'auto' ? shape.strokeWidth() : hitWidth;
        native.strokeStyle = shape.colorKey;
        native.stroke(path);
      }
      native.restore();
    },
    sceneFunc(context, shape) {
      if (width <= 0 || height <= 0) return;
      const native = context._context;
      const path = createPath();
      const center = fill.center ?? { x: 0.5, y: 0.5 };
      const radius = fill.radius ?? { x: 0.5, y: 0.5 };
      const cx = width * center.x + origin.x;
      const cy = height * center.y + origin.y;
      const rx = width * radius.x;
      const ry = height * radius.y;
      native.save();
      const normalizedPath = new Path2D();
      normalizedPath.addPath(path, new DOMMatrix([1 / rx, 0, 0, 1 / ry, -cx / rx, -cy / ry]));
      native.translate(cx, cy);
      native.scale(rx, ry);
      const gradient = native.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const stop of fill.stops) {
        const hex = stop.color.replace('#', '');
        const color = `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${(stop.opacity ?? 1) * opacity})`;
        gradient.addColorStop(stop.position, color);
      }
      native.fillStyle = gradient;
      native.fill(normalizedPath);
      native.restore();

      if (!shape.hasStroke() || !shape.strokeEnabled()) return;
      native.save();
      native.lineWidth = shape.strokeWidth();
      native.setLineDash(shape.dashEnabled() ? shape.dash() ?? [] : []);
      if (!shape.shadowForStrokeEnabled()) native.shadowColor = 'transparent';
      const stops = shape.strokeLinearGradientColorStops();
      if (stops) {
        const start = shape.strokeLinearGradientStartPoint();
        const end = shape.strokeLinearGradientEndPoint();
        const stroke = native.createLinearGradient(start.x, start.y, end.x, end.y);
        for (let index = 0; index < stops.length; index += 2) {
          const position = stops[index];
          const color = stops[index + 1];
          if (typeof position !== 'number' || typeof color !== 'string') throw new Error('Invalid gradient stroke stops');
          stroke.addColorStop(position, color);
        }
        native.strokeStyle = stroke;
      } else native.strokeStyle = shape.stroke();
      native.stroke(path);
      native.restore();
    },
  };
}
