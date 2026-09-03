import type { AnyExtension } from '@tiptap/core';
import type { HostConversationInputExtension } from '../definitions/conversationInputExtensions';

function requireDescriptorId(value: string): string {
  const id = value.trim();
  if (!id) {
    throw new Error('[conversationInputExtensions] editor extension id 不能为空');
  }
  return id;
}

/** 所有静态扩展都在 composer Editor 构造期创建，激活期只切换各扩展自己的行为 gate。 */
export function createConversationInputEditorExtensions(
  extensions: readonly HostConversationInputExtension[],
): AnyExtension[] {
  const descriptors = extensions.flatMap(extension => extension.editorExtensions);
  const descriptorIds = new Set<string>();

  for (const descriptor of descriptors) {
    const id = requireDescriptorId(descriptor.id);
    if (descriptorIds.has(id)) {
      throw new Error(`[conversationInputExtensions] editor extension 重复注册: ${id}`);
    }
    descriptorIds.add(id);
  }

  return descriptors.map(descriptor => descriptor.create());
}
