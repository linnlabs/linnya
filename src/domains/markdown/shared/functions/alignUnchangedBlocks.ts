export interface BlockMatch {
  readonly source: number;
  readonly target: number;
}

/**
 * 按出现次序匹配相同段落，再取保持文档顺序的最长子序列。
 * 重复段落始终先匹配较早的同文段落；不把文本当成块身份，也不因首部插入而平移旧块身份。
 * O(N log N) 的对齐保留大文档能力；重排暂以删除/新增呈现，不伪造 move 修订。
 */
export function alignUnchangedBlocks(
  sources: readonly string[],
  targets: readonly string[],
): BlockMatch[] {
  const positions = new Map<string, number[]>();
  sources.forEach((text, source) => {
    const list = positions.get(text) ?? [];
    list.push(source);
    positions.set(text, list);
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
