// console.log('[CodeBlockExtension.js] File loaded and parsed by browser.'); // 清理

import { Extension } from '@tiptap/core';
import { handleCodeBlockEnter, handleCodeBlockShiftEnter } from './keyboard/CodeBlockKeys';

export const CodeBlockExtension = Extension.create({
  name: 'codeBlockKeyboardHandler',

  // 这个扩展依赖 KeyboardListener 来确保 keyboardRegistry 可用

  onCreate() {

    if (!this.editor) {
      return;
    }
    if (!this.editor.storage.keyboardRegistry) {
      return;
    }

    const registry = this.editor.storage.keyboardRegistry;
    const editor = this.editor; // 在闭包中使用 editor 实例

    // 注册 CodeBlock 内的回车处理
    registry.register({
      keys: 'Enter',
      handler: (context) => {
        const editorInstance = editor || context.editor;
        if (!editorInstance) {
          return false;
        }
        const isActive = editorInstance.isActive('codeBlock');
        if (isActive) {
          const result = handleCodeBlockEnter({ 
            event: context.event, 
            editor: editorInstance, 
            debugLog: context.debugLog // Pass along for potential future use in CodeBlockKeys, though it's also cleaned there
          });
          return result;
        }
        return false;
      },
      phase: 'pre', 
      priority: 100, 
      id: 'codeBlock-enter-newline'
    });

    // 注册 CodeBlock 内的 Shift+Enter 处理
    registry.register({
      keys: 'Shift-Enter',
      handler: (context) => {
        const editorInstance = editor || context.editor;
        if (editorInstance.isActive('codeBlock')) { 
          const result = handleCodeBlockShiftEnter({ 
            event: context.event, 
            editor: editorInstance, 
            debugLog: context.debugLog // Pass along
          });
          return result;
        }
        return false;
      },
      phase: 'pre',
      priority: 100, 
      id: 'codeBlock-shift-enter-split'
    });

    // Tab 键的处理仍然可以在 CodeBlock.js 的 addKeyboardShortcuts 中完成，
    // 因为它不涉及复杂的优先级或覆盖问题。
    // 或者，如果想统一管理，也可以在这里注册Tab键的处理。
  },

  onDestroy() {
    if (this.editor && this.editor.storage.keyboardRegistry) {
      this.editor.storage.keyboardRegistry.unregister('codeBlock-enter-newline');
      this.editor.storage.keyboardRegistry.unregister('codeBlock-shift-enter-split');
    }
  }
});

export default CodeBlockExtension; 