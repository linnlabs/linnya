/**
 * AnnoLayoutPlugin.js
 * 
 * 批注布局插件 - 监听文档结构变化，触发批注位置重新计算
 * 基于 Tiptap 扩展机制实现
 * 
 * 主要职责：
 * 1. 监听整个文档的结构变化（增删块、内容变化导致高度变化等）
 * 2. 当检测到变化时，触发所有批注面板的位置重新计算
 * 3. 确保批注面板的位置始终与对应的块位置保持同步
 * 
 * 与 BlockEventHandler.js 的职责区分：
 * - AnnoLayoutPlugin: 监听全局文档结构变化，负责批注位置的视觉呈现 (UI层面)
 * - BlockEventHandler: 处理具体的块操作事件，维护批注数据的增删改 (数据层面)
 * 
 * 工作原理：
 * 使用 ProseMirror 的 appendTransaction 钩子，在文档变化后触发位置重新计算
 * 这是一个被动的监听机制，不直接处理批注数据本身，仅更新位置
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { throttle } from 'lodash';

// 创建 Plugin Key
const annotationLayoutPluginKey = new PluginKey('annotationLayoutPlugin');

export const AnnotationLayoutPlugin = Extension.create({
  name: 'annotationLayoutPlugin',

  addOptions() {
    return {
      layoutManager: null, // 将通过选项注入layoutManager引用
      throttleDelay: 150   // 节流延迟时间(ms)
    };
  },

  addProseMirrorPlugins() {
    const layoutManager = this.options.layoutManager;
    const extensionThis = this; // 保存 this 引用
    
    // 创建节流版本的重算函数
    const recalculatePositionsThrottled = throttle(() => {
      if (layoutManager && typeof layoutManager.recalculateAllPositions === 'function') {
        // 使用true参数，将面板重置到理想位置后处理重叠
        layoutManager.recalculateAllPositions(true);
      }
    }, this.options.throttleDelay);

    return [
      new Plugin({
        key: annotationLayoutPluginKey,
        
        // 在事务应用后检查是否需要重新计算位置
        appendTransaction: (transactions, oldState, newState) => {
          // pending 注入期间跳过布局重算，注入完成后由滚动/渲染自然触发
          const isPendingApply = transactions.some(tr => tr.getMeta('pendingRevisionApply'));
          if (isPendingApply) return null;

          // 仅在文档结构变化时触发
          const docChanged = transactions.some(tr => {
            // 检查是否有实际的文档变化
            if (!tr.docChanged) return false;
            
            // 优化：排除仅文本输入和简单删除的事务
            // 这些操作通常不会影响块的位置
            const inputType = tr.getMeta('inputType');
            if (inputType === 'insertText' || 
                inputType === 'deleteContentBackward' ||
                inputType === 'deleteContentForward') {
              // 文本输入和简单删除通常不会影响块的位置
              return false;
            }

            return true;
          });
          
          if (docChanged) {
            // 使用setTimeout避免在当前事务完成前修改DOM
            setTimeout(() => {
              // 确保访问 this.editor 是安全的
              if (extensionThis.editor && extensionThis.editor.view) {
                // 注意：这里只负责位置重算，不处理批注数据的增删改
                // 批注数据的维护由 BlockEventHandler.js 负责
                recalculatePositionsThrottled();
              } else {
                // 编辑器可能尚未完全初始化或已被销毁
                console.warn('[AnnoLayoutPlugin] Editor or view not available when trying to recalculate positions.');
              }
            }, 0);
          }
          
          return null; // 不创建新事务
        }
      })
    ];
  }
});

/**
 * 这个插件与 BlockEventHandler.js 协同工作：
 * - BlockEventHandler 处理特定的块操作事件（删除、移动、复制等），确保批注数据一致性
 * - AnnoLayoutPlugin 处理所有可能导致批注位置变化的文档结构变化
 * 
 * 两者是互补关系：
 * 1. BlockEventHandler 能处理特定操作的数据维护，但可能漏掉一些隐式的位置变化
 * 2. AnnoLayoutPlugin 能捕获所有位置变化，但不具备数据维护的业务逻辑
 */

// 导出默认对象便于导入
export default AnnotationLayoutPlugin; 