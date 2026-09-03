/**
 * TableKeyboardExtension.js
 * 
 * 此扩展为 TableBlock 节点提供专门的键盘处理逻辑，
 * 主要用于处理 Enter, Tab, Shift-Tab, ArrowUp 等键在表格单元格内的行为。
 * 这些处理依赖于 KeyboardListener 扩展提供的 KeyboardRegistry。
 */
import { Extension } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';
import { handleEnterKey, handleTabKey, handleShiftTabKey, handleArrowVertical } from '../tableKeys';
import { handleArrowUpNavigation } from '../position/tableNavigationUtils';

export const TableKeyboardExtension = Extension.create({
  name: 'tableKeyboardSupport',

  onCreate() {
    if (!this.editor) {
      console.warn('[TableKeyboardExtension] Editor instance not available during onCreate.');
      return;
    }
    if (!this.editor.storage.keyboardRegistry) {
      console.warn('[TableKeyboardExtension] KeyboardRegistry not found. Keyboard handlers for table not registered.');
      return;
    }

    const registry = this.editor.storage.keyboardRegistry;
    const editorInstance = this.editor;

    registry.register({
      keys: 'Enter',
      handler: (context) => {
        const currentEditor = editorInstance || context.editor;
        if (!currentEditor) return false;
        if (currentEditor.isActive('table')) {
          return handleEnterKey({ editor: currentEditor, event: context.event });
        }
        return false;
      },
      phase: 'pre',
      priority: 100,
      id: 'table-block-enter-key'
    });

    registry.register({
      keys: 'Tab',
      handler: (context) => {
        const currentEditor = editorInstance || context.editor;
        if (!currentEditor) return false;
        if (currentEditor.isActive('table')) {
          return handleTabKey({ editor: currentEditor, event: context.event });
        }
        return false;
      },
      phase: 'pre',
      priority: 100,
      id: 'table-block-tab-key'
    });

    registry.register({
      keys: 'Shift-Tab',
      handler: (context) => {
        const currentEditor = editorInstance || context.editor;
        if (!currentEditor) return false;
        if (currentEditor.isActive('table')) {
          return handleShiftTabKey({ editor: currentEditor, event: context.event });
        }
        return false;
      },
      phase: 'pre',
      priority: 100,
      id: 'table-block-shift-tab-key'
    });

    registry.register({
      keys: 'ArrowUp',
      handler: (context) => {
        const { editor, event } = context;
        if (!editor) return false;

        // 统一使用垂直导航逻辑。
        // 当光标在表格第一行的顶部时，handleArrowVertical 会返回 false，
        // 从而允许事件冒泡，由更高层的处理器（或ProseMirror默认行为）处理，
        // 实现从表格跳出到上一个块。
        return handleArrowVertical({
          editor,
          event,
          direction: -1
        });
      },
      phase: 'pre',
      priority: 100,
      id: 'table-block-arrow-up'
    });

    registry.register({
      keys: 'ArrowDown',
      handler: (context) => {
        const { editor, event } = context;
        if (!editor || !editor.isActive('table')) return false;

        return handleArrowVertical({
          editor,
          event,
          direction: 1
        });
      },
      phase: 'pre',
      priority: 100,
      id: 'table-block-arrow-down'
    });
  },

  onDestroy() {
    if (this.editor && this.editor.storage.keyboardRegistry) {
      this.editor.storage.keyboardRegistry.unregister('table-block-enter-key');
      this.editor.storage.keyboardRegistry.unregister('table-block-tab-key');
      this.editor.storage.keyboardRegistry.unregister('table-block-shift-tab-key');
      this.editor.storage.keyboardRegistry.unregister('table-block-arrow-up');
      this.editor.storage.keyboardRegistry.unregister('table-block-arrow-down');
    }
  }
}); 