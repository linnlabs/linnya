import { defaultRangeExtractor, type Range } from '@tanstack/vue-virtual';

export function extractVirtualizerSpikeRange(range: Range, pinnedTailCount: number): number[] {
  const indexes = new Set(defaultRangeExtractor(range));
  const safePinnedCount = Math.max(0, Math.floor(pinnedTailCount));
  const firstPinnedIndex = Math.max(0, range.count - safePinnedCount);

  for (let index = firstPinnedIndex; index < range.count; index += 1) {
    indexes.add(index);
  }

  return Array.from(indexes).sort((left, right) => left - right);
}
