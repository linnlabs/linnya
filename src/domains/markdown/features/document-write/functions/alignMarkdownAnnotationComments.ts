import type { PlannedMarkdownAnnotationComment } from '../../normalization';
import type { FlattenedMarkdownBlock } from '../../../shared';
import type { MarkdownBlockWriteStep } from '../definitions/markdownBlockWritePlan';

/** 批注跟随对齐后的块身份；文首新增不能把后面全部批注错挂到相邻块。 */
export function alignMarkdownAnnotationComments(
  steps: readonly MarkdownBlockWriteStep[],
  baseline: readonly FlattenedMarkdownBlock[],
  comments: readonly PlannedMarkdownAnnotationComment[],
): PlannedMarkdownAnnotationComment[] {
  const sourceIndexes = new Map(baseline.map((block, index) => [block.blockId, index]));
  const targetIndexes: Array<number | undefined> = [];
  for (const step of steps) {
    if (step.kind === 'delete') continue;
    targetIndexes.push(step.kind === 'insert' ? undefined : sourceIndexes.get(step.candidate.block.blockId));
  }
  return comments.map(comment => {
    const sourceIndex = targetIndexes[comment.targetBlockIndex];
    if (sourceIndex === undefined) throw new Error('新增正文块尚处于 Revision pending，不能在接受前承载批注。');
    return { ...comment, targetBlockIndex: sourceIndex };
  });
}
