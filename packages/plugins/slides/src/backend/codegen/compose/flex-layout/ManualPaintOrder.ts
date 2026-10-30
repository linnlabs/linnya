import type { LayoutResult } from './YogaAdapter';
/** 先完成 Yoga 再排序绘制；无作者 key 的节点保留原槽位。 */
export function orderManualPaint(result: LayoutResult, order: readonly string[]): LayoutResult {
  if (order.length === 0) return result;
  const children = result.children.map(child => orderManualPaint(child, order));
  const rank = new Map(order.map((key, index) => [key, index]));
  const keyed = children.filter(child => 'editKey' in child.node && child.node.editKey && rank.has(child.node.editKey));
  function position(child: LayoutResult): number { return 'editKey' in child.node && child.node.editKey ? rank.get(child.node.editKey) ?? 0 : 0; }
  keyed.sort((a, b) => position(a) - position(b));
  let index = 0;
  return { ...result, children: children.map(child => 'editKey' in child.node && child.node.editKey && rank.has(child.node.editKey) ? keyed[index++] : child) };
}
