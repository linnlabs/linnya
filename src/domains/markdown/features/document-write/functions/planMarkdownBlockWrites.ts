import { alignUnchangedBlocks } from '../../../shared/functions/alignUnchangedBlocks';
import type {
  MarkdownBlockWriteCandidate,
  MarkdownBlockWriteStep,
} from '../definitions/markdownBlockWritePlan';

function planExistingBlock(
  candidate: MarkdownBlockWriteCandidate,
  markdown: string,
  comparisonText: string,
  targetIndex: number,
  separator: 'tight' | 'loose' | null,
): MarkdownBlockWriteStep {
  // 已有块恢复基线时，清除提议；新增占位块直到正式接受前都保持 insert 身份。
  if (candidate.pending?.operation !== 'insert' && comparisonText === candidate.block.text && separator === (candidate.block.listSeparatorBefore ?? null)) {
    return candidate.pending
      ? { kind: 'cancel', candidate }
      : { kind: 'retain', candidate, markdown, targetIndex };
  }
  if (candidate.pending?.operation !== 'delete' && comparisonText === candidate.currentText && separator === (candidate.currentListSeparatorBefore ?? null)) {
    return { kind: 'retain', candidate, markdown, targetIndex };
  }
  return { kind: 'update', candidate, markdown, targetIndex };
}

export function planMarkdownBlockWrites(input: {
  readonly candidates: readonly MarkdownBlockWriteCandidate[];
  readonly markdown: readonly string[];
  readonly comparison: readonly string[];
  readonly listSeparators?: readonly ('tight' | 'loose' | null)[];
}): MarkdownBlockWriteStep[] {
  const { candidates, markdown, comparison } = input;
  const matches = alignUnchangedBlocks(candidates.map(candidate => candidate.currentText), comparison);
  const result: MarkdownBlockWriteStep[] = [];
  let source = 0;
  let target = 0;

  for (const match of [...matches, { source: candidates.length, target: markdown.length }]) {
    while (source < match.source && target < match.target) {
      const candidate = candidates[source++];
      const text = markdown[target];
      const normalized = comparison[target++];
      if (!candidate || text === undefined || normalized === undefined) throw new Error('Invalid Markdown write plan');
      result.push(planExistingBlock(candidate, text, normalized, target - 1, input.listSeparators?.[target - 1] ?? null));
    }
    while (source < match.source) {
      const candidate = candidates[source++];
      if (candidate && candidate.pending?.operation !== 'delete') result.push({ kind: 'delete', candidate });
    }
    while (target < match.target) {
      const text = markdown[target++];
      if (text !== undefined) result.push({ kind: 'insert', markdown: text, targetIndex: target - 1 });
    }
    const candidate = candidates[match.source];
    const text = markdown[match.target];
    const normalized = comparison[match.target];
    if (candidate && text !== undefined && normalized !== undefined) {
      result.push(planExistingBlock(candidate, text, normalized, match.target, input.listSeparators?.[match.target] ?? null));
    }
    source = match.source + 1;
    target = match.target + 1;
  }
  return result;
}
