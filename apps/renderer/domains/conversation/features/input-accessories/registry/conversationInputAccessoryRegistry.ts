import { shallowRef } from 'vue';
import type { ConversationInputAccessoryContribution } from '@linnya/plugin-host-contract/renderer';

const registeredAccessories = shallowRef<readonly ConversationInputAccessoryContribution[]>([]);

function requireIdentityPart(value: string, field: 'pluginId' | 'id'): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`[conversationInputAccessories] ${field} 不能为空`);
  }
  return normalized;
}

function buildAccessoryKey(pluginId: string, id: string): string {
  return `${requireIdentityPart(pluginId, 'pluginId')}:${requireIdentityPart(id, 'id')}`;
}

export function registerConversationInputAccessory(
  contribution: ConversationInputAccessoryContribution,
): void {
  const key = buildAccessoryKey(contribution.pluginId, contribution.id);
  if (registeredAccessories.value.some(candidate => (
    buildAccessoryKey(candidate.pluginId, candidate.id) === key
  ))) {
    throw new Error(`[conversationInputAccessories] accessory 重复注册: ${key}`);
  }
  registeredAccessories.value = [...registeredAccessories.value, contribution];
}

export function unregisterConversationInputAccessory(pluginId: string, id: string): boolean {
  const key = buildAccessoryKey(pluginId, id);
  const next = registeredAccessories.value.filter(candidate => (
    buildAccessoryKey(candidate.pluginId, candidate.id) !== key
  ));
  if (next.length === registeredAccessories.value.length) return false;
  registeredAccessories.value = next;
  return true;
}

/** 读取 shallowRef 值以保留运行期注册与卸载的响应式更新。 */
export function readConversationInputAccessories(): readonly ConversationInputAccessoryContribution[] {
  return registeredAccessories.value;
}

export function clearConversationInputAccessoriesForTest(): void {
  registeredAccessories.value = [];
}
