import {
  MarkdownAnnotationsSchema,
  type MarkdownAnnotation,
} from '@app/schemas';
import type {
  MarkdownDocJson,
  ProseMirrorJsonNode,
} from '../../normalization/runtime';

export interface MarkdownAnnotationInsertion {
  readonly blockId: string;
  readonly annotation: MarkdownAnnotation;
}

/** 把一批 Annotation 原子地投影进同一份 Markdown 文档 JSON。 */
export function appendMarkdownAnnotations(
  document: MarkdownDocJson,
  insertions: readonly MarkdownAnnotationInsertion[],
): MarkdownDocJson {
  if (insertions.length === 0) return document;

  const byBlockId = new Map<string, MarkdownAnnotation[]>();
  for (const insertion of insertions) {
    const annotation = MarkdownAnnotationsSchema.element.parse(insertion.annotation);
    const bucket = byBlockId.get(insertion.blockId);
    if (bucket) bucket.push(annotation);
    else byBlockId.set(insertion.blockId, [annotation]);
  }

  const foundBlockIds = new Set<string>();
  const content: ProseMirrorJsonNode[] = document.content.map(rootBlock => {
    if (rootBlock.type !== 'rootBlock') return rootBlock;
    const blockId = typeof rootBlock.attrs?.id === 'string' ? rootBlock.attrs.id : null;
    if (!blockId) return rootBlock;
    const additions = byBlockId.get(blockId);
    if (!additions) return rootBlock;

    foundBlockIds.add(blockId);
    const existing = MarkdownAnnotationsSchema.parse(rootBlock.attrs?.annotations ?? []);
    const ids = new Set(existing.map(annotation => annotation.id));
    for (const addition of additions) {
      if (ids.has(addition.id)) {
        throw new Error(`[MarkdownAnnotation] Annotation ID 重复: ${addition.id}`);
      }
      ids.add(addition.id);
    }
    return {
      ...rootBlock,
      attrs: {
        ...(rootBlock.attrs ?? {}),
        annotations: [...existing, ...additions],
      },
    };
  });

  const missing = [...byBlockId.keys()].filter(blockId => !foundBlockIds.has(blockId));
  if (missing.length > 0) {
    throw new Error(`[MarkdownAnnotation] 目标块不存在: ${missing.join(', ')}`);
  }

  return { ...document, content };
}
