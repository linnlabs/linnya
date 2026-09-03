import { Extension } from '@tiptap/core';
import { handleAnnotationCreate } from '../keyboard/AnnotationKeys';
import { PositionUtils } from '../../../extensions/position/PositionUtils';
// import { useAnnotationStore } from '../useAnnotationStore'; // AnnotationStore 会从 editor 实例获取

const HANDLE_ANNOTATION_CREATE_ID = Symbol.for('annotationCreateKeyHandler');

export const AnnotationKeyboardExtension = Extension.create({
  name: 'annotationKeyboardExtension',

  onCreate() {
    if (!this.editor.storage.keyboardRegistry) {
      console.error('[AnnotationKeyboardExtension] KeyboardRegistry not found on editor.storage. Cannot register annotation keyboard handlers.');
      return;
    }

    // 快捷键定义 (macOS: Cmd+Option+A, Win/Linux: Ctrl+Alt+M)
    // KeyboardRegistry 的 matchKey 会处理 Mod (Cmd/Ctrl)
    // 我们需要为 Alt (Option on Mac) 单独处理或确保 KeyboardRegistry 支持
    // 暂时使用一个通用的键组合，稍后根据 KeyboardRegistry 的能力调整
    // 或者让 AnnotationKeys.js 内部自己判断 دقیق的修饰键组合
    const keys = ['Mod-Alt-A', 'Ctrl-Alt-M']; // 两个平台的快捷键

    this.editor.storage.keyboardRegistry.register({
      keys: keys, // 传递一个数组，让 KeyboardRegistry 尝试匹配任何一个
      handler: (context) => {
        const posUtils = new PositionUtils(context.editor);
        const annotationStore = context.editor.annotationStore; // 从 editor 实例获取

        if (!annotationStore) {
          console.error('[AnnotationKeyboardExtension] AnnotationStore not found on editor instance.');
          return false; // 或者 true 如果我们想阻止默认行为即使出错了
        }
        return handleAnnotationCreate({
          view: context.view, // handleAnnotationCreate 实际上不需要 view
          event: context.event,
          $cursor: context.state.selection.$cursor,
          editor: context.editor, // 传递 editor 实例
          // 传递实例化后的工具或 store，或者适配 handleAnnotationCreate
          getPosUtils: () => posUtils, 
          getAnnotationStore: () => annotationStore,
          debugLog: (...args) => { if (/* dev_flag */ false) console.debug('[AnnoKeyboardExtension->handleAnnotationCreate]', ...args); },
        });
      },
      phase: 'normal', 
      priority: 0, 
      id: HANDLE_ANNOTATION_CREATE_ID,
    });
  },

  onDestroy() {
    if (this.editor.storage.keyboardRegistry) {
      this.editor.storage.keyboardRegistry.unregister(HANDLE_ANNOTATION_CREATE_ID);
    }
  },
});

export default AnnotationKeyboardExtension; 