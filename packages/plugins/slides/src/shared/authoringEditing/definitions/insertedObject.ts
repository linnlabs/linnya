import type { SlidesEditableTextContent, SlidesAuthorTextStyle } from './editableText';

export interface SlidesInsertedObjectBase {
  readonly editKey: string;
  /** 新对象使用独立绝对定位，不改变原有 Flex 作者树。单位 inches。 */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}
export type SlidesInsertedObject = SlidesInsertedObjectBase & (
  | {
    readonly kind: 'text';
    readonly content: SlidesEditableTextContent;
    readonly style: SlidesAuthorTextStyle;
    /** content 的 box.h 仅用于插入占位；minimum 和历史未声明值保留最小高度。 */
    readonly heightMode?: 'content' | 'minimum';
  }
  | { readonly kind: 'shape'; readonly geometry: 'rect' | 'ellipse'; readonly fill: string; readonly content: SlidesEditableTextContent }
  | {
    readonly kind: 'image';
    readonly assetId: string;
    readonly fit: 'contain' | 'cover';
    readonly alt: string;
    /** 复制带取景的图片时原样保留；语义同 deck.js `Image.crop` / `Image.focus`。 */
    readonly crop?: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
    readonly focus?: { readonly x: number; readonly y: number };
  }
);
