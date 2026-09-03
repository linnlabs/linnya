export interface SidebarSortableConversation {
  last_event_at: number;
  is_pinned?: boolean;
  pinned_at?: number;
}

/**
 * 侧边栏对话列表的本地排序规则。
 *
 * 中文说明：
 * - 后端已经按置顶优先排序；这里用于置顶/取消置顶后的乐观局部更新；
 * - 规则必须与后端保持一致，否则点击置顶后列表会先跳到一个位置，刷新后又变一次。
 */
function compareSidebarConversations(
  left: SidebarSortableConversation,
  right: SidebarSortableConversation,
): number {
  const leftPinned = left.is_pinned === true;
  const rightPinned = right.is_pinned === true;

  if (leftPinned !== rightPinned) {
    return leftPinned ? -1 : 1;
  }

  if (leftPinned && rightPinned) {
    return (right.pinned_at ?? 0) - (left.pinned_at ?? 0);
  }

  return right.last_event_at - left.last_event_at;
}

export function sortSidebarConversations<T extends SidebarSortableConversation>(conversations: T[]): T[] {
  return [...conversations].sort(compareSidebarConversations);
}
