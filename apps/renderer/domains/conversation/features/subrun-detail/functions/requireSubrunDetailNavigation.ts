import type { SubrunDetailNavigationPort } from '../definitions/subrunDetail';

/** 装配错误在具名边界失败，Vue 组件本身只消费已接纳端口。 */
export function requireSubrunDetailNavigation(
  value: SubrunDetailNavigationPort | undefined,
): SubrunDetailNavigationPort {
  if (!value) {
    throw new Error('SubrunDetailNavigationPort 未装配：详情与 Host 父卡必须由 ConversationHost 挂载');
  }
  return value;
}
