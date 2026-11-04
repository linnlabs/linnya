// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { expect, it, vi } from 'vitest';
import { useConversationInputPlaceholder } from './useConversationInputPlaceholder';

it('项目与语言切换刷新空输入提示，不清草稿、选区或撤销链，也不产生正文更新', async () => {
  const placeholder = ref('询问与「项目A」有关的一切'), update = vi.fn();
  const editor = new Editor({ element: document.createElement('div'), content: '',
    extensions: [Document, Paragraph, Text, UndoRedo, Placeholder.configure({ placeholder: () => placeholder.value })], onUpdate: update });
  const scope = effectScope(); scope.run(() => useConversationInputPlaceholder(placeholder, () => editor));
  const decoration = () => editor.view.dom.querySelector('[data-placeholder]')?.getAttribute('data-placeholder');
  try {
    expect(decoration()).toBe('询问与「项目A」有关的一切');
    placeholder.value = '询问与「项目B」有关的一切'; await nextTick();
    expect(decoration()).toBe('询问与「项目B」有关的一切'); expect(update).not.toHaveBeenCalled();
    placeholder.value = 'Ask about Project B'; await nextTick();
    expect(decoration()).toBe('Ask about Project B'); expect(editor.commands.undo()).toBe(false);
    editor.commands.insertContent('保留草稿'); editor.commands.setTextSelection(3);
    const content = editor.getJSON(), selection = editor.state.selection.toJSON(); update.mockClear();
    placeholder.value = '另一个项目'; await nextTick();
    expect(editor.getJSON()).toEqual(content); expect(editor.state.selection.toJSON()).toEqual(selection); expect(update).not.toHaveBeenCalled();
    expect(editor.commands.undo()).toBe(true); expect(editor.getText()).toBe('');
    expect(decoration()).toBe('另一个项目');
    scope.stop(); placeholder.value = '已卸载的上下文'; await nextTick();
    expect(decoration()).toBe('另一个项目');
  } finally { scope.stop(); editor.destroy(); }
});
