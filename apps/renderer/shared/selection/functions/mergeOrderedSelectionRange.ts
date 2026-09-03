import type { OrderedSelectionRangeInput } from '../definitions/orderedSelectionRange';

/**
 * 将锚点到目标位置的闭区间并入现有选择，并保持已有选择的插入顺序。
 *
 * 锚点或目标不在当前有序列表时返回 null，由业务 owner 决定保持原状态还是结束选择。
 */
export function mergeOrderedSelectionRange(
  input: OrderedSelectionRangeInput,
): readonly string[] | null {
  const anchorIndex = input.orderedIds.indexOf(input.anchorId);
  const targetIndex = input.orderedIds.indexOf(input.targetId);
  if (anchorIndex === -1 || targetIndex === -1) return null;

  const [start, end] = [anchorIndex, targetIndex].sort((left, right) => left - right);
  const selectedIds = new Set(input.selectedIds);
  for (let index = start; index <= end; index += 1) {
    selectedIds.add(input.orderedIds[index]);
  }

  return [...selectedIds];
}
