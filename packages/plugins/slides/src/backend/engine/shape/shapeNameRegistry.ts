/**
 * Slides preset geometry → PptxGenJS adapter。
 *
 * deck.js 名称已经在 shared/shapeGeometry 严格校验；backend 不再接受任意字符串、
 * 不维护别名，也不把未知值静默降级为矩形。
 */

import type PptxGenJS from 'pptxgenjs';
import type { PresetShapeName } from '@plugin/slides/shared';

export function presetShapeNameToPptxName(name: PresetShapeName): PptxGenJS.SHAPE_NAME {
  switch (name) {
    case 'rect': return 'rect';
    case 'roundRect': return 'roundRect';
    case 'ellipse': return 'ellipse';
    case 'triangle': return 'triangle';
    case 'rightTriangle': return 'rtTriangle';
    case 'diamond': return 'diamond';
    case 'pentagon': return 'pentagon';
    case 'hexagon': return 'hexagon';
    case 'star5': return 'star5';
    case 'rightArrow': return 'rightArrow';
    case 'line': return 'line';
    case 'callout': return 'wedgeRectCallout';
    case 'parallelogram': return 'parallelogram';
    case 'trapezoid': return 'trapezoid';
    case 'nonIsoscelesTrapezoid': return 'nonIsoscelesTrapezoid';
    case 'chevron': return 'chevron';
  }
}
