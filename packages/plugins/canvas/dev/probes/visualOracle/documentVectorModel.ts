import type { VisualDocumentVector } from './definitions';
import { compositeVisualColor, parseVisualColor } from './visualColor';

/** 正式文档标签图标的描边宽度：markdown-document-core 样式为 1.15；1 是该样式之前的原件。 */
const DOCUMENT_ICON_STROKE_WIDTHS = new Set(['1px', '1.15px']);

/** 描边可以是半透明的单一墨色：叠到底色上必须正好是采集到的可见颜色。 */
function qualifiedStroke(paint: VisualDocumentVector['paint']): boolean {
  const stroke = parseVisualColor(paint.stroke);
  return stroke !== null && stroke.alpha > 0
    && compositeVisualColor(stroke, paint.background).every((channel, index) => channel === paint.color[index]);
}

function qualifiedPaint(paint: VisualDocumentVector['paint']): boolean {
  return paint.fill === 'none' && qualifiedStroke(paint)
    && DOCUMENT_ICON_STROKE_WIDTHS.has(paint.strokeWidth) && paint.strokeLinecap === 'round' && paint.strokeLinejoin === 'round'
    && paint.strokeDasharray === 'none' && paint.strokeDashoffset === '0px' && paint.vectorEffect === 'none'
    && paint.opacity === '1' && paint.fillOpacity === '1' && paint.strokeOpacity === '1'
    && paint.transform === 'none' && paint.visibility === 'visible' && paint.filter === 'none'
    && paint.clipPath === 'none' && paint.maskImage === 'none';
}

/** 只有本夹具真实DocumentIcon的单色描边可获模型资格；不是任意SVG的AA豁免。 */
export function qualifiesDocumentVector(vector: VisualDocumentVector): boolean {
  return vector.geometryKind === 'document-reference-icon' && vector.rect.width > 0 && vector.rect.height > 0
    && vector.viewBox.x === 0 && vector.viewBox.y === 0 && vector.viewBox.width === 24 && vector.viewBox.height === 24
    && vector.transform === null && vector.childNames.length === 2 && vector.childNames.every(name => name === 'path')
    && vector.paths.length === 2 && qualifiedPaint(vector.paint)
    && vector.paths.every(path => path.d !== null && path.d.length > 0 && path.transform === null && qualifiedPaint(path.paint)
      && JSON.stringify(path.paint) === JSON.stringify(vector.paint));
}
