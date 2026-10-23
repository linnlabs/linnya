import type { Node } from 'prosemirror-model';
import { MarkdownImageAttrsSchema, type MarkdownImageAttrs } from '@app/schemas';

/** 引用仅在当前文档内解释；复制时由物化层为每次出现分配新的块身份。 */
export function collectEditorImageSources(doc: Node): ReadonlyMap<string, MarkdownImageAttrs> {
  const sources = new Map<string, MarkdownImageAttrs>();
  doc.descendants(node => {
    if (node.type.name !== 'imageBlock') return;
    const image = MarkdownImageAttrsSchema.parse(node.attrs);
    sources.set(image.id, image);
    return false;
  });
  return sources;
}
