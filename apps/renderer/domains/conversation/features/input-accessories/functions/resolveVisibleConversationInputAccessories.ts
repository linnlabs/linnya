import type { ConversationInputAccessoryContribution } from '@linnya/plugin-host-contract/renderer';

/** Input Extension 接管输入期间不叠加 Accessory；普通输入时按贡献自身可见性过滤。 */
export function resolveVisibleConversationInputAccessories(
  accessories: readonly ConversationInputAccessoryContribution[],
  blockedByInputExtension: boolean,
): readonly ConversationInputAccessoryContribution[] {
  if (blockedByInputExtension) return [];
  return accessories.filter(accessory => accessory.isVisible?.() !== false);
}
