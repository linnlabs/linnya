import { watch, type Ref } from 'vue';
import type { Editor } from '@tiptap/core';

/** Placeholder是ProseMirror装饰；项目/语言变化本身不会触发其重新计算。 */
export function useConversationInputPlaceholder(
  placeholder: Readonly<Ref<string>>,
  readEditor: () => Pick<Editor, 'commands' | 'isDestroyed'> | null | undefined,
): void {
  watch(placeholder, () => {
    const editor = readEditor();
    // 保留同一编辑器、正文与选区，仅让装饰读取当前文案；不进入撤销历史。
    if (editor && !editor.isDestroyed) editor.commands.setMeta('addToHistory', false);
  });
}
