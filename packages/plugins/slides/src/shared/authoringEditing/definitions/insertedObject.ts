import type { SlidesEditableTextContent, SlidesAuthorTextStyle } from './editableText';

interface SlidesInsertedObjectBase {
  readonly editKey: string;
  /** 新对象使用独立绝对定位，不改变原有 Flex 作者树。单位 inches。 */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}
export type SlidesInsertedObject = SlidesInsertedObjectBase & (
  | { readonly kind: 'text'; readonly content: SlidesEditableTextContent; readonly style: SlidesAuthorTextStyle }
  | { readonly kind: 'shape'; readonly geometry: 'rect' | 'ellipse'; readonly fill: string; readonly content: SlidesEditableTextContent }
  | { readonly kind: 'image'; readonly assetId: string; readonly fit: 'contain' | 'cover'; readonly alt: string }
);
