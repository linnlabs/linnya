import {
  MarkdownAnnotationsSchema,
  type MarkdownAnnotation,
} from '@app/schemas';
import type { PlannedMarkdownAnnotationComment } from '../../normalization';
import type { FlattenedMarkdownBlock } from '../../../shared';
import type { MarkdownAnnotationCreationDraft } from '../orchestration/createMarkdownAnnotations';

interface JsonNodeLike {
  readonly type?: unknown;
  readonly attrs?: unknown;
  readonly content?: unknown;
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
 * 将 file-style Markdown 中的普通 comment 规划为 Annotation 创建草稿。
 *
 * canonical envelope 只允许原样保留；修改或删除已有批注属于另一类 Annotation 命令，
 * 不能偷偷降级成 Revision pending，也不能把模型手写的身份当成新业务事实。
 */
export function planMarkdownFileAnnotationCreations(params: {
  readonly currentDocument: unknown;
  readonly currentBlocks: readonly FlattenedMarkdownBlock[];
  readonly annotationComments: readonly PlannedMarkdownAnnotationComment[];
}): readonly MarkdownAnnotationCreationDraft[] {
  const currentByBlockId = readAnnotationsByBlockId(params.currentDocument);
  const commentsByIndex = new Map<number, PlannedMarkdownAnnotationComment[]>();
  for (const comment of params.annotationComments) {
    const bucket = commentsByIndex.get(comment.targetBlockIndex);
    if (bucket) bucket.push(comment);
    else commentsByIndex.set(comment.targetBlockIndex, [comment]);
  }

  const drafts: MarkdownAnnotationCreationDraft[] = [];
  for (let index = 0; index < params.currentBlocks.length; index += 1) {
    const block = params.currentBlocks[index];
    if (!block) continue;
    const targetComments = commentsByIndex.get(index) ?? [];
    const targetCanonical = targetComments
      .filter(comment => comment.parsed.kind === 'canonical')
      .map(comment => comment.parsed.kind === 'canonical' ? comment.parsed.annotation : null)
      .filter((annotation): annotation is MarkdownAnnotation => annotation !== null);
    const current = currentByBlockId.get(block.blockId) ?? [];

    if (
      current.length !== targetCanonical.length
      || current.some(annotation => {
        const target = targetCanonical.find(candidate => candidate.id === annotation.id);
        return !target || !annotationsEqual(annotation, target);
      })
    ) {
      throw new Error(
        `[MarkdownAnnotation] ${block.ref} 的 canonical 批注只能原样保留；` +
        '修改或删除批注必须走 Annotation 命令。'
      );
    }

    for (const comment of targetComments) {
      if (comment.parsed.kind !== 'plain') continue;
      drafts.push({ blockId: block.blockId, content: comment.parsed.draft.content });
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

  return drafts;
}
