import PptxGenJS from 'pptxgenjs';
import type { Paint, StrokePaint } from '@plugin/slides/shared';
import { toPptxHexColor } from '@plugin/slides/shared';

/** PptxGenJS 已能无损写出 none/solid；只有 gradient 需要原生 OOXML 修订计划。 */
export function requiresNativePptxPaintPatch(paint: Paint | StrokePaint | undefined): boolean {
  return paint?.type === 'linear' || paint?.type === 'radial';
}

/** PptxGenJS 先写可见占位；最终视觉事实由 OOXML Paint adapter 覆盖。 */
export function mapPaintToPptxFill(
  paint: Paint,
  parentOpacity?: number,
): PptxGenJS.ShapeFillProps {
  if (paint.type === 'none') return { type: 'none' };
  if (paint.type === 'solid') {
    return {
      type: 'solid',
      color: toPptxHexColor(paint.color, 'paint.color'),
      ...toTransparency(combineOpacity(paint.opacity, parentOpacity)),
    };
  }
  const first = paint.stops[0];
  return {
    type: 'solid',
    color: toPptxHexColor(first.color, 'paint.stops[0].color'),
    ...toTransparency(combineOpacity(first.opacity, parentOpacity)),
  };
}

export function mapStrokePaintToPptxLine(
  paint: StrokePaint,
  width: number,
  dash?: 'solid' | 'dash' | 'dot',
): PptxGenJS.ShapeLineProps {
  const fill = mapPaintToPptxFill(paint);
  return {
    ...fill,
    width,
    dashType: dash === 'dot' ? 'sysDot' : dash === 'dash' ? 'dash' : 'solid',
  };
}

function combineOpacity(own: number | undefined, parent: number | undefined): number | undefined {
  if (own == null) return parent;
  if (parent == null) return own;
  return own * parent;
}

function toTransparency(opacity: number | undefined): { transparency?: number } {
  if (opacity == null) return {};
  return { transparency: Math.round((1 - opacity) * 100) };
}
