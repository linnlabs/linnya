/**
 * ClipboardListener.js
 * 
 * 统一的剪贴板事件监听器
 * 作为 Tiptap Extension，监听 paste 和 drop 事件，并分发给注册的处理器
 * 
 * 参考 KeyboardListener 的设计模式
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { PasteRegistry } from './PasteRegistry';

/**
 * 调试开关（运行时可打开，无需反复改代码）
 *
 * 开启方式（任选其一）：
 * - 在 DevTools Console 执行：localStorage.setItem('EDITOR_CLIPBOARD_DEBUG', '1')
 * - 或执行：globalThis.__EDITOR_CLIPBOARD_DEBUG__ = true
 *
 * 关闭方式：
 * - localStorage.removeItem('EDITOR_CLIPBOARD_DEBUG')
 * - 或 globalThis.__EDITOR_CLIPBOARD_DEBUG__ = false
 *
 * 注意：打开后日志可能包含剪贴板 HTML 片段，排查完请务必关闭。
 */
function isClipboardDebugEnabled() {
  try {
    if (globalThis.__EDITOR_CLIPBOARD_DEBUG__ === true) {
      return true;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('EDITOR_CLIPBOARD_DEBUG') === '1';
    }
    return false;
  } catch (e) {
    return false;
  }
}

const debugLog = (...args) => {
  if (isClipboardDebugEnabled()) {
    console.log('[ClipboardListener]', ...args);
  }
};

export const ClipboardListener = Extension.create({
  name: 'clipboardListener',

  /**
   * 在编辑器创建时初始化 PasteRegistry
   */
  onCreate() {
    if (!this.editor.storage.pasteRegistry) {
      this.editor.storage.pasteRegistry = new PasteRegistry();
      debugLog('✅ 已创建 PasteRegistry 实例');
    }

    // 如果开启了 Clipboard Debug，同步开启 PasteRegistry 的调试模式
    if (isClipboardDebugEnabled()) {
      this.editor.storage.pasteRegistry.setDebugMode(true);
    }
  },

  /**
   * 添加 ProseMirror 插件来处理剪贴板事件
   */
  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: new PluginKey('unifiedClipboardHandler'),
        
        props: {
          /**
           * 处理 DOM 事件
           */
          handleDOMEvents: {
            /**
             * 处理粘贴事件
             */
            paste: (view, event) => {
              debugLog('🔥 粘贴事件被捕获');

              const debugEnabled = isClipboardDebugEnabled();

              // 让 PasteRegistry 的 debugMode 与当前开关保持一致（可在运行时开关，不依赖重启编辑器）
              if (extension.editor?.storage?.pasteRegistry) {
                const pasteRegistry = extension.editor.storage.pasteRegistry;
                if (pasteRegistry.debugMode !== debugEnabled) {
                  pasteRegistry.setDebugMode(debugEnabled);
                }
              }

              // 仅在 DEBUG 模式下打印剪贴板关键数据，便于定位“Word 表格粘贴”差异
              if (debugEnabled && event?.clipboardData) {
                try {
                  const types = Array.from(event.clipboardData.types || []);
                  const html = event.clipboardData.getData('text/html') || '';
                  const plain = event.clipboardData.getData('text/plain') || '';

                  debugLog('📋 clipboardData.types =', types);
                  debugLog('📋 text/plain(前200) =', plain.slice(0, 200));
                  debugLog('📋 text/html(前500) =', html.slice(0, 500));
                } catch (e) {
                  // DEBUG 日志失败不影响粘贴链路
                }
              }
              
              const { state, dispatch } = view;
              const editor = extension.editor;
              
              // 构建上下文对象，传递给处理器
              const context = {
                view,
                event,
                state,
                dispatch,
                editor,
                selection: state.selection,
                doc: state.doc,
                debugLog
              };

              // 分发到 PasteRegistry
              if (editor.storage.pasteRegistry) {
                const handled = editor.storage.pasteRegistry.dispatchPaste(event, context);
                return handled;
              }

              debugLog('⚠️  PasteRegistry 不存在，使用默认处理');
              return false;
            },

            /**
             * 处理拖放事件
             */
            drop: (view, event) => {
              debugLog('🔥 拖放事件被捕获');
              
              const { state, dispatch } = view;
              const editor = extension.editor;
              
              const context = {
                view,
                event,
                state,
                dispatch,
                editor,
                selection: state.selection,
                doc: state.doc,
                debugLog
              };

              // 分发到 PasteRegistry
              if (editor.storage.pasteRegistry) {
                const handled = editor.storage.pasteRegistry.dispatchDrop(event, context);
                return handled;
              }

              debugLog('⚠️  PasteRegistry 不存在，使用默认处理');
              return false;
            },

            /**
             * 处理拖拽悬停事件（允许拖放）
             */
            dragover: (view, event) => {
              // 检查是否有文件或图片数据
              if (event.dataTransfer) {
                const hasFiles = event.dataTransfer.types.includes('Files');
                const hasImage = Array.from(event.dataTransfer.items || []).some(item => 
                  item.kind === 'file' && item.type.startsWith('image/')
                );
                
                if (hasFiles || hasImage) {
                  // 阻止默认行为以允许拖放
                  event.preventDefault();
                  return true;
                }
              }
              
              return false;
            }
          }
        }
      })
    ];
  },

  /**
   * 销毁时清理资源
   */
  onDestroy() {
    if (this.editor.storage.pasteRegistry) {
      this.editor.storage.pasteRegistry.clear();
      debugLog('🧹 已清理 PasteRegistry');
    }
  }
});

export default ClipboardListener;

