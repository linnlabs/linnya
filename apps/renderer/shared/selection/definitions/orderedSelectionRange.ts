/**
 * 把有序列表中由 anchorId 与 targetId 确定的闭区间并入已有选择。
 *
 * 中文说明：这里只定义跨业务稳定的 ID 选择契约，不包含“谁是锚点”或“何时触发 Shift”
 * 等领域语义；这些决定仍由各自的 domain 持有。
 */
export interface OrderedSelectionRangeInput {
  readonly selectedIds: Iterable<string>;
  readonly orderedIds: readonly string[];
  readonly anchorId: string;
  readonly targetId: string;
}
