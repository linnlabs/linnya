import { describe, expect, it } from 'vitest';
import { mergeOrderedSelectionRange } from './mergeOrderedSelectionRange';

describe('mergeOrderedSelectionRange', () => {
  it('正向与反向选择都合并锚点到目标的闭区间', () => {
    const orderedIds = ['a', 'b', 'c', 'd'];

    expect(mergeOrderedSelectionRange({
      selectedIds: [],
      orderedIds,
      anchorId: 'b',
      targetId: 'd',
    })).toEqual(['b', 'c', 'd']);
    expect(mergeOrderedSelectionRange({
      selectedIds: [],
      orderedIds,
      anchorId: 'c',
      targetId: 'a',
    })).toEqual(['a', 'b', 'c']);
  });

  it('保留已有选择并拒绝列表外的范围端点', () => {
    const orderedIds = ['a', 'b', 'c', 'd'];

    expect(mergeOrderedSelectionRange({
      selectedIds: ['d'],
      orderedIds,
      anchorId: 'a',
      targetId: 'c',
    })).toEqual(['d', 'a', 'b', 'c']);
    expect(mergeOrderedSelectionRange({
      selectedIds: ['a'],
      orderedIds,
      anchorId: 'missing',
      targetId: 'c',
    })).toBeNull();
  });
});
