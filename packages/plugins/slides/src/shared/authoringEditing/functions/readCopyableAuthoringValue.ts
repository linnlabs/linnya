import type { FreeformElement, StructuredElement } from '../../deckSpec';
import type { SlidesInsertedObject } from '../definitions/insertedObject';
import { isAuthorTextStyle, isEditableTextContent } from './editableText';

type InsertedObjectValue<T> = T extends unknown ? Omit<T, 'editKey' | 'box'> : never;
export type SlidesCopyableAuthoringValue = InsertedObjectValue<SlidesInsertedObject>;

/**
 * 只接受能无损写成插入对象的作者值；复杂样式返回 null，绝不压平丢样式。
 * 编译器据此投影 `copy` 能力，复制接口据此取值，两边不能各自维护一份规则。
 */
export function readCopyableAuthoringValue(element: FreeformElement | StructuredElement): SlidesCopyableAuthoringValue | null {
  const textStyle = Object.fromEntries(Object.entries('style' in element ? element.style ?? {} : {}).filter(([, value]) => value !== undefined));
  if ((element.type === 'text' || element.type === 'title') && (!('textWrap' in element) || element.textWrap === undefined || element.textWrap === 'word')
    && isEditableTextContent(element.content) && isAuthorTextStyle(textStyle)) {
    return { kind: 'text', content: element.content, style: textStyle };
  }
  if (element.type === 'shape') {
    const geometry = element.geometry ?? 'rect';
    const preset = typeof geometry === 'string' ? geometry : geometry.type === 'preset' ? geometry.name : null;
    const style = element.style;
    const content = 'content' in element ? element.content : 'text' in element ? element.text : '';
    if ((preset === 'rect' || preset === 'ellipse') && (content === undefined || isEditableTextContent(content))
      && !style?.border && !style?.shadow && !style?.rotate && !style?.borderRadius && (style?.opacity === undefined || style.opacity === 1)
      && style?.paint?.type === 'solid' && (style.paint.opacity === undefined || style.paint.opacity === 1)) {
      return { kind: 'shape', geometry: preset, content: content ?? '', fill: style.paint.color };
    }
  }
  if (element.type === 'image' && typeof element.src === 'object' && element.src.kind === 'document_asset'
    && !element.rotate && !element.flipH && !element.flipV && !element.rounding && !element.shadow && !element.transparency && (!element.maskShape || element.maskShape === 'rect')) {
    return { kind: 'image', assetId: element.src.assetId, fit: element.fitMode === 'contain' ? 'contain' : 'cover', alt: element.alt ?? '' };
  }
  return null;
}
