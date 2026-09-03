/**
 * 表格列宽调整扩展
 * 此扩展提供拖动调整表格列宽的功能
 * 特性：仅第一列无法调整宽度（避免与拖拽手柄冲突）
 */

import { Extension } from '@tiptap/core';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Plugin, PluginKey } from 'prosemirror-state';
import { columnResizing } from 'prosemirror-tables';
import {
  dispatchTableColumnResizeKeepAlive,
  findColumnResizeHandleFromEventTarget,
  findRootBlockIdFromColumnResizeTarget,
  isFirstColumnResizeHandle,
} from './tableColumnResizeKeepAlive';

// 插件的唯一标识键
export const TableColumnResizePluginKey = new PluginKey('tableColumnResize');

// 创建自定义列宽调整插件函数
export function createColumnResizePlugin() {
  let activeResizeBlockId = null;
  let activeResizeView = null;

  const releaseResizeKeepAlive = () => {
    if (!activeResizeBlockId || !activeResizeView) return;

    dispatchTableColumnResizeKeepAlive(activeResizeView.dom, activeResizeBlockId, false);
    activeResizeView.dom.classList.remove('resize-cursor');
    activeResizeBlockId = null;
    activeResizeView = null;
  };

  return new Plugin({
    key: TableColumnResizePluginKey,
    
    // 插件状态初始化
    state: {
      init() {
        return {
          dragging: null,
          decorations: DecorationSet.empty,
        };
      },
      
      // 状态应用函数
      apply(tr, prev) {
        return prev;
      },
    },
    
    // DOM事件处理，以确保拖拽时的交互效果
    props: {
      // 设置拖拽时鼠标样式
      handleDOMEvents: {
        mousemove(view, event) {
          const handle = findColumnResizeHandleFromEventTarget(event.target);
          if (handle) {
            // 第一列保留给块级拖拽/选择交互，不显示 resize cursor。
            if (isFirstColumnResizeHandle(handle)) {
              view.dom.classList.remove('resize-cursor');
              return false;
            }
            view.dom.classList.add('resize-cursor');
          } else {
            view.dom.classList.remove('resize-cursor');
          }
          return false;
        },

        mousedown(view, event) {
          const handle = findColumnResizeHandleFromEventTarget(event.target);
          if (!handle || isFirstColumnResizeHandle(handle)) return false;

          const blockId = findRootBlockIdFromColumnResizeTarget(handle);
          if (!blockId) return false;

          if (activeResizeBlockId && activeResizeBlockId !== blockId) {
            releaseResizeKeepAlive();
          }

          activeResizeBlockId = blockId;
          activeResizeView = view;
          dispatchTableColumnResizeKeepAlive(view.dom, blockId, true);
          return false;
        },
        
        mouseleave(view) {
          view.dom.classList.remove('resize-cursor');
          return false;
        }
      },
    },

    view() {
      const releaseOnDragEnd = () => {
        releaseResizeKeepAlive();
      };

      if (typeof window === 'undefined') {
        return {
          destroy() {
            releaseResizeKeepAlive();
          },
        };
      }

      window.addEventListener('mouseup', releaseOnDragEnd, true);
      window.addEventListener('blur', releaseOnDragEnd);

      return {
        destroy() {
          window.removeEventListener('mouseup', releaseOnDragEnd, true);
          window.removeEventListener('blur', releaseOnDragEnd);
          releaseResizeKeepAlive();
        },
      };
    },
  });
}

export const TableColumnResizeExtension = Extension.create({
  name: 'tableColumnResize',

  // 添加配置选项
  addOptions() {
    return {
      // 列宽最小值（像素）
      minWidth: 50,
      // 列宽调整处理器CSS类名
      handleWidth: 7,
      // 允许调整最后一列
      lastColumnResizable: true,
      // 最小单元格宽度
      cellMinWidth: 50,
    };
  },

  // 添加扩展配置
  addProseMirrorPlugins() {
    return [
      // 使用ProseMirror表格列宽调整插件
      columnResizing({
        handleWidth: this.options.handleWidth,
        cellMinWidth: this.options.cellMinWidth,
        // 处理拖拽结束时的事件
        onResize: (oldState, transaction) => {
          // 可在此处添加额外处理（如触发事件等）
          console.log('Column resize complete');

          // 通知坐标轴组件需要重新测量
          // 通过在事务上设置元数据来标记列宽已改变
          if (!transaction.getMeta('columnResized')) {
            transaction.setMeta('columnResized', true);
          }
        },
        // 不允许调整最后一列
        lastColumnResizable: this.options.lastColumnResizable,
        // 表格边缘无法调整宽度
        firstColumnResizable: false,
      }),
      // 额外的插件用于处理自定义UI和交互，并禁用边缘列的调整
      createColumnResizePlugin(),
    ];
  },
});

export default TableColumnResizeExtension;
