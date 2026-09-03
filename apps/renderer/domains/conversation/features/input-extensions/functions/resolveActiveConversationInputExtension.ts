import type { HostConversationInputExtension } from '../definitions/conversationInputExtensions';

export function resolveActiveConversationInputExtension(
  extensions: readonly HostConversationInputExtension[],
): HostConversationInputExtension | null {
  const activeExtensions = extensions.filter(extension => extension.isActive.value);
  if (activeExtensions.length > 1) {
    throw new Error(
      `[conversationInputExtensions] 同时激活了多个输入扩展: ${activeExtensions
        .map(extension => extension.id)
        .join(', ')}`,
    );
  }
  return activeExtensions[0] ?? null;
}
