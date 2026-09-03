import { shallowRef } from 'vue';
import type { HostConversationInputExtension } from '../definitions/conversationInputExtensions';

const registeredExtensions = shallowRef<readonly HostConversationInputExtension[]>([]);

function requireExtensionId(value: string): string {
  const id = value.trim();
  if (!id) {
    throw new Error('[conversationInputExtensions] extension id 不能为空');
  }
  return id;
}

export function registerConversationInputExtension(
  extension: HostConversationInputExtension,
): void {
  const id = requireExtensionId(extension.id);
  if (registeredExtensions.value.some(candidate => requireExtensionId(candidate.id) === id)) {
    throw new Error(`[conversationInputExtensions] 输入扩展重复注册: ${id}`);
  }
  registeredExtensions.value = [...registeredExtensions.value, extension];
}

export function unregisterConversationInputExtension(id: string): boolean {
  const normalizedId = requireExtensionId(id);
  const next = registeredExtensions.value.filter(
    extension => requireExtensionId(extension.id) !== normalizedId,
  );
  if (next.length === registeredExtensions.value.length) return false;
  registeredExtensions.value = next;
  return true;
}

/** 读取时保留 shallowRef 依赖追踪，供上层 computed 感知注册变化。 */
export function readConversationInputExtensions(): readonly HostConversationInputExtension[] {
  return registeredExtensions.value;
}

export function clearConversationInputExtensionsForTest(): void {
  registeredExtensions.value = [];
}
