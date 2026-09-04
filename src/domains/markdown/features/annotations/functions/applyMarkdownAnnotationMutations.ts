import {
  MarkdownAnnotationSchema,
  MarkdownAnnotationsSchema,
  type MarkdownAnnotation,
} from '@app/schemas';
import type { MarkdownDocJson, ProseMirrorJsonNode } from '../../normalization/runtime';
import type { MarkdownAnnotationInsertion } from './appendMarkdownAnnotations';

export interface MarkdownAnnotationUpdate {
  readonly blockId: string;
  readonly annotation: MarkdownAnnotation;
}

export interface MarkdownAnnotationDeletion {
  readonly blockId: string;
  readonly annotationId: string;
}

function groupByBlockId<T extends { readonly blockId: string }>(
  items: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const bucket = grouped.get(item.blockId);
    if (bucket) bucket.push(item);
    else grouped.set(item.blockId, [item]);
  }
  return grouped;
}

/** 将一批 Annotation 增删改原子投影为目标文档 JSON。 */
export function applyMarkdownAnnotationMutations(params: {
  readonly document: MarkdownDocJson;
  readonly insertions: readonly MarkdownAnnotationInsertion[];
  readonly updates: readonly MarkdownAnnotationUpdate[];
  readonly deletions: readonly MarkdownAnnotationDeletion[];
}): MarkdownDocJson {
  if (
    params.insertions.length === 0
    && params.updates.length === 0
    && params.deletions.length === 0
  ) return params.document;

  const insertionsByBlock = groupByBlockId(params.insertions);
  const updatesByBlock = groupByBlockId(params.updates);
  const deletionsByBlock = groupByBlockId(params.deletions);
  const requestedBlockIds = new Set([
    ...insertionsByBlock.keys(),
    ...updatesByBlock.keys(),
    ...deletionsByBlock.keys(),
  ]);
  const foundBlockIds = new Set<string>();

  const content: ProseMirrorJsonNode[] = params.document.content.map(rootBlock => {
    if (rootBlock.type !== 'rootBlock') return rootBlock;
    const blockId = typeof rootBlock.attrs?.id === 'string' ? rootBlock.attrs.id : null;
    if (!blockId || !requestedBlockIds.has(blockId)) return rootBlock;
    foundBlockIds.add(blockId);

    const existing = MarkdownAnnotationsSchema.parse(rootBlock.attrs?.annotations ?? []);
    const existingIds = new Set(existing.map(annotation => annotation.id));
    const deletions = deletionsByBlock.get(blockId) ?? [];
    const updates = updatesByBlock.get(blockId) ?? [];
    const insertions = insertionsByBlock.get(blockId) ?? [];
    const deletionIds = new Set(deletions.map(deletion => deletion.annotationId));
    const updateById = new Map(
      updates.map(update => {
        const annotation = MarkdownAnnotationSchema.parse(update.annotation);
        return [annotation.id, annotation] as const;
      }),
    );

    for (const annotationId of deletionIds) {
      if (!existingIds.has(annotationId)) {
        throw new Error(`[MarkdownAnnotation] 待删除批注不存在: ${annotationId}`);
      }
      if (updateById.has(annotationId)) {
        throw new Error(`[MarkdownAnnotation] 同一批注不能同时编辑和删除: ${annotationId}`);
      }
    }
    for (const annotationId of updateById.keys()) {
      if (!existingIds.has(annotationId)) {
        throw new Error(`[MarkdownAnnotation] 待编辑批注不存在: ${annotationId}`);
      }
    }

    const additions = insertions.map(insertion => MarkdownAnnotationSchema.parse(insertion.annotation));
    const next = existing
      .filter(annotation => !deletionIds.has(annotation.id))
      .map(annotation => updateById.get(annotation.id) ?? annotation);
    const nextIds = new Set(next.map(annotation => annotation.id));
    for (const addition of additions) {
      if (nextIds.has(addition.id)) {
        throw new Error(`[MarkdownAnnotation] Annotation ID 重复: ${addition.id}`);
      }
      nextIds.add(addition.id);
      next.push(addition);
    }

    return {
      ...rootBlock,
      attrs: { ...(rootBlock.attrs ?? {}), annotations: next },
    };
  });

  const missing = [...requestedBlockIds].filter(blockId => !foundBlockIds.has(blockId));
  if (missing.length > 0) {
    throw new Error(`[MarkdownAnnotation] 目标块不存在: ${missing.join(', ')}`);
  }

  const documentIds = new Set<string>();
  for (const rootBlock of content) {
    if (rootBlock.type !== 'rootBlock') continue;
    for (const annotation of MarkdownAnnotationsSchema.parse(rootBlock.attrs?.annotations ?? [])) {
      if (documentIds.has(annotation.id)) {
        throw new Error(`[MarkdownAnnotation] 文档内 Annotation ID 重复: ${annotation.id}`);
      }
      documentIds.add(annotation.id);
    }
  }

  return { ...params.document, content };
}
