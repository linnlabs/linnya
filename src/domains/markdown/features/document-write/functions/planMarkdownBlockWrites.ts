import type {
  MarkdownBlockWriteCandidate,
  MarkdownBlockWriteStep,
} from '../definitions/markdownBlockWritePlan';

interface BlockMatch {
  readonly source: number;
  readonly target: number;
}

/**
 * 按出现次序匹配相同段落，再取保持文档顺序的最长子序列。
 * 重复段落始终先匹配较早的同文段落；不把文本当成块身份，也不因首部插入而平移旧块身份。
 * O(N log N) 的对齐保留大文档能力；重排暂以删除/新增呈现，不伪造 move 修订。
 */
function alignUnchangedBlocks(
  candidates: readonly MarkdownBlockWriteCandidate[],
  targets: readonly string[],
): BlockMatch[] {
  const positions = new Map<string, number[]>();
  candidates.forEach((candidate, source) => {
    const list = positions.get(candidate.currentText) ?? [];
    list.push(source);
    positions.set(candidate.currentText, list);
  });
  const occurrences = new Map<string, number>();
  const matches: BlockMatch[] = [];
  targets.forEach((text, target) => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    const source = positions.get(text)?.[occurrence];
    if (source !== undefined) matches.push({ source, target });
  });

  const tails: number[] = [];
  const predecessors: number[] = [];
  matches.forEach((match, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const tailIndex = tails[middle];
      const tail = tailIndex === undefined ? undefined : matches[tailIndex];
      if (tail && tail.source < match.source) low = middle + 1;
      else high = middle;
    }
    predecessors[index] = low > 0 ? (tails[low - 1] ?? -1) : -1;
    tails[low] = index;
  });
  const aligned: BlockMatch[] = [];
  let index = tails[tails.length - 1] ?? -1;
  while (index >= 0) {
    const match = matches[index];
    if (!match) throw new Error('Invalid Markdown block alignment');
    aligned.push(match);
    index = predecessors[index] ?? -1;
  }
  return aligned.reverse();
}

function planExistingBlock(
  candidate: MarkdownBlockWriteCandidate,
  markdown: string,
  comparisonText: string,
): MarkdownBlockWriteStep {
  // 已有块恢复基线时，清除提议；新增占位块直到正式接受前都保持 insert 身份。
  if (candidate.pending?.operation !== 'insert' && comparisonText === candidate.block.text) {
    return candidate.pending
      ? { kind: 'cancel', candidate }
      : { kind: 'retain', candidate, markdown };
  }
  if (candidate.pending?.operation !== 'delete' && comparisonText === candidate.currentText) {
    return { kind: 'retain', candidate, markdown };
  }
  return { kind: 'update', candidate, markdown };
}

export function planMarkdownBlockWrites(input: {
  readonly candidates: readonly MarkdownBlockWriteCandidate[];
  readonly markdown: readonly string[];
  readonly comparison: readonly string[];
}): MarkdownBlockWriteStep[] {
  const { candidates, markdown, comparison } = input;
  const matches = alignUnchangedBlocks(candidates, comparison);
  const result: MarkdownBlockWriteStep[] = [];
  let source = 0;
  let target = 0;

  for (const match of [...matches, { source: candidates.length, target: markdown.length }]) {
    while (source < match.source && target < match.target) {
      const candidate = candidates[source++];
      const text = markdown[target];
      const normalized = comparison[target++];
      if (!candidate || text === undefined || normalized === undefined) throw new Error('Invalid Markdown write plan');
      result.push(planExistingBlock(candidate, text, normalized));
    }
    while (source < match.source) {
      const candidate = candidates[source++];
      if (candidate && candidate.pending?.operation !== 'delete') result.push({ kind: 'delete', candidate });
    }
    while (target < match.target) {
      const text = markdown[target++];
      if (text !== undefined) result.push({ kind: 'insert', markdown: text });
    }
    const candidate = candidates[match.source];
    const text = markdown[match.target];
    const normalized = comparison[match.target];
    if (candidate && text !== undefined && normalized !== undefined) {
      result.push(planExistingBlock(candidate, text, normalized));
    }
    source = match.source + 1;
    target = match.target + 1;
  }
  return result;
}
