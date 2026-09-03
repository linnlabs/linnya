/**
 * DebugKeyboardExtension.js
 * 
 * 提供调试快捷键功能，允许开发者通过键盘快捷键查看编辑器结构和状态
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import * as DebugUtils from '../../../../shared/utils/DebugUtils';

export const DebugKeyboardExtension = Extension.create({
  name: 'debugKeyboard',

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: new PluginKey('debugKeyboard'),
        props: {
          handleKeyDown(view, event) {
            // 仅在开发环境中启用 (可选)
            if (!import.meta.env.DEV) return false;
            
            // 检查是否按下 Alt + D 组合键
            if (event.altKey && event.key === 'd') {
              console.group('编辑器调试信息');
              console.log('触发时间:', new Date().toLocaleTimeString());
              console.log('编辑器状态:', extension.editor.view.state);
              
              // 显示文档结构
              DebugUtils.logDocumentStructure(extension.editor);
              
              // 显示选区信息
              DebugUtils.logSelectionInfo(extension.editor);
              
              console.log('命令:', Object.keys(extension.editor.commands));
              console.groupEnd();
              
              return true; // 阻止事件传播
            }
            
            // Alt + N 查看光标所在节点
            if (event.altKey && event.key === 'n') {
              const { state } = view;
              const { selection } = state;
              const { from } = selection;
              
              state.doc.nodesBetween(from, from, (node, pos) => {
                console.group('光标所在节点');
                DebugUtils.logNodeInfo(node, '节点信息:');
                console.log('位置:', pos);
                console.log('是否为空:', DebugUtils.isEmptyBlock(node));
                console.groupEnd();
                return false; // 只查看第一个节点
              });
              
              return true;
            }
            
            // Alt + P 打印完整路径
            if (event.altKey && event.key === 'p') {
              const { state } = view;
              const { selection } = state;
              const { from } = selection;
              const $pos = state.doc.resolve(from);
              
              console.group('节点路径');
              console.log('当前位置:', from);
              
              for (let depth = $pos.depth; depth >= 0; depth--) {
                const node = $pos.node(depth);
                console.group(`深度 ${depth}`);
                DebugUtils.logNodeInfo(node);
                console.groupEnd();
              }
              
              console.groupEnd();
              return true;
            }
            
            return false;
          }
        }
      })
    ];
  }
});

export default DebugKeyboardExtension; 