import {
  MarkdownAnnotationsSchema,
  type MarkdownAnnotation,
} from '@app/schemas';
import type { PlannedMarkdownAnnotationComment } from '../../normalization';
import type { FlattenedMarkdownBlock } from '../../../shared';
import type {
  MarkdownAnnotationCreationDraft,
} from '../orchestration/applyMarkdownAnnotationChanges';
import type {
  MarkdownAnnotationDeletion,
  MarkdownAnnotationUpdate,
} from './applyMarkdownAnnotationMutations';

interface JsonNodeLike {
  readonly type?: unknown;
  readonly attrs?: unknown;
}

export interface MarkdownFileAnnotationChangePlan {
  readonly creations: readonly MarkdownAnnotationCreationDraft[];
  readonly updates: readonly MarkdownAnnotationUpdate[];
  readonly deletions: readonly MarkdownAnnotationDeletion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readAnnotationsByBlockId(document: unknown): ReadonlyMap<string, readonly MarkdownAnnotation[]> {
  const annotationsByBlockId = new Map<string, readonly MarkdownAnnotation[]>();
  if (!isRecord(document) || !Array.isArray(document.content)) return annotationsByBlockId;

  for (const candidate of document.content) {
    const node: JsonNodeLike = isRecord(candidate) ? candidate : {};
    if (node.type !== 'rootBlock' || !isRecord(node.attrs)) continue;
    const blockId = node.attrs.id;
    if (typeof blockId !== 'string') continue;
    annotationsByBlockId.set(
      blockId,
      MarkdownAnnotationsSchema.parse(node.attrs.annotations ?? []),
    );
  }
  return annotationsByBlockId;
}

function annotationsEqual(left: MarkdownAnnotation, right: MarkdownAnnotation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 把 file-style Markdown 的 comment 字符变化解释为 Annotation 增删改。
 * 普通 comment 只表达新增；canonical envelope 以稳定 ID 表达保留、编辑或删除。
 */
export function planMarkdownFileAnnotationChanges(params: {
  readonly currentDocument: unknown;
  readonly currentBlocks: readonly FlattenedMarkdownBlock[];
  readonly annotationComments: readonly PlannedMarkdownAnnotationComment[];
}): MarkdownFileAnnotationChangePlan {
  const currentByBlockId = readAnnotationsByBlockId(params.currentDocument);
  const commentsByIndex = new Map<number, PlannedMarkdownAnnotationComment[]>();
  for (const comment of params.annotationComments) {
    const bucket = commentsByIndex.get(comment.targetBlockIndex);
    if (bucket) bucket.push(comment);
    else commentsByIndex.set(comment.targetBlockIndex, [comment]);
  }

  const creations: MarkdownAnnotationCreationDraft[] = [];
  const updates: MarkdownAnnotationUpdate[] = [];
  const deletions: MarkdownAnnotationDeletion[] = [];

  for (let index = 0; index < params.currentBlocks.length; index += 1) {
    const block = params.currentBlocks[index];
    if (!block) continue;
    const targetComments = commentsByIndex.get(index) ?? [];
    const targetCanonical = targetComments
      .filter(comment => comment.parsed.kind === 'canonical')
      .map(comment => comment.parsed.kind === 'canonical' ? comment.parsed.annotation : null)
      .filter((annotation): annotation is MarkdownAnnotation => annotation !== null);
    const current = currentByBlockId.get(block.blockId) ?? [];
    const currentById = new Map(current.map(annotation => [annotation.id, annotation]));
    const targetIds = new Set<string>();

    for (const annotation of targetCanonical) {
      if (targetIds.has(annotation.id)) {
        throw new Error(`[MarkdownAnnotation] ${block.ref} 重复声明批注: ${annotation.id}`);
      }
      targetIds.add(annotation.id);
      const existing = currentById.get(annotation.id);
      if (!existing) {
        throw new Error(
          `[MarkdownAnnotation] ${block.ref} 包含未知 canonical 批注 ${annotation.id}；` +
          '新增批注请使用普通 HTML comment。'
        );
      }
      if (!annotationsEqual(existing, annotation)) {
        updates.push({ blockId: block.blockId, annotation });
      }
    }

    for (const annotation of current) {
      if (!targetIds.has(annotation.id)) {
        deletions.push({ blockId: block.blockId, annotationId: annotation.id });
      }
    }
    for (const comment of targetComments) {
      if (comment.parsed.kind === 'plain') {
        creations.push({ blockId: block.blockId, content: comment.parsed.draft.content });
      }
    }
  }

  const commentOnNewBlock = params.annotationComments.find(
    comment => comment.targetBlockIndex >= params.currentBlocks.length
  );
  if (commentOnNewBlock) {
    throw new Error(
      '[MarkdownAnnotation] 新增正文块尚处于 Revision pending，不能在接受前承载批注。'
    );
  }

  return { creations, updates, deletions };
}
