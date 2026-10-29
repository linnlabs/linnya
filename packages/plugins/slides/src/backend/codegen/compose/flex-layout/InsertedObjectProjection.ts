import type { SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';
import type { LayoutNode, LayoutSlideNode } from './LayoutTypes';

/** 新对象先成为普通作者节点，之后共用身份校验、Yoga、人工值、预览和导出。 */
export function appendInsertedObjects(slide: LayoutSlideNode, additions: readonly SlidesInsertedObject[] = []): LayoutSlideNode {
  if (additions.length === 0) return slide;
  return { ...slide, children: [...slide.children, ...additions.map(object => ({ ...toLayoutNode(object), _sourceSpan: slide._insertedObjectLocations?.[object.editKey] }))] };
}
function toLayoutNode(object: SlidesInsertedObject): LayoutNode {
  const base = { editKey: object.editKey, position: { ...object.box } };
  switch (object.kind) {
    case 'text': return { ...base, _type: 'Text', content: typeof object.content === 'string' ? [{ text: object.content, style: object.style }] : object.content.map(run => ({ ...run, style: { ...object.style, ...run.style } })),
      fontSize: object.style.fontSize, fontFamily: object.style.fontFamily, color: object.style.color,
      fontWeight: object.style.bold ? 'bold' : 'normal', fontStyle: object.style.italic ? 'italic' : 'normal',
      textDecoration: object.style.underline ? 'underline' : 'none', textAlign: object.style.align,
      verticalAlign: object.style.valign, letterSpacing: object.style.letterSpacing,
      lineHeight: object.style.lineSpacing?.kind === 'multiple' ? object.style.lineSpacing.value : undefined };
    case 'shape': return { ...base, _type: 'Shape', geometry: object.geometry, fill: object.fill, content: object.content };
    case 'image': return { ...base, _type: 'Image', src: { kind: 'document_asset', assetId: object.assetId }, fitMode: object.fit, alt: object.alt };
  }
}
