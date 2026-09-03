// src/renderer/extensions/interaction/drag/CustomDropCursorPlugin.js
/**
 * CustomDropCursorPlugin.js
 * 
 * 自定义拖拽指示器逻辑
 * 提供拖拽指示器的创建、显示、隐藏和位置计算功能
 */

import { Extension } from '@tiptap/core'
import { Plugin } from 'prosemirror-state'

// 创建自定义拖拽指示器元素
let dropIndicator = null;

const ROOT_BLOCK_OUTER_SELECTOR = '.root-block-outer';
const ROOT_BLOCK_INNER_SELECTOR = '.root-block';
const VIEWPORT_SAMPLE_Y_OFFSETS = [0, -32, 32];
const DRAG_PERF_HISTORY_LIMIT = 80;
const dragPerfHistory = [];
let pendingDragOverFrame = 0;
let pendingDragOverSample = null;
let pendingDragOverEventCount = 0;

function publishDragPerf(sample) {
  dragPerfHistory.push({
    ...sample,
    timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  });
  if (dragPerfHistory.length > DRAG_PERF_HISTORY_LIMIT) {
    dragPerfHistory.splice(0, dragPerfHistory.length - DRAG_PERF_HISTORY_LIMIT);
  }

  if (typeof window !== 'undefined' && !window.__EDITOR_DRAG_PERF__) {
    window.__EDITOR_DRAG_PERF__ = {
      getLast: () => dragPerfHistory[dragPerfHistory.length - 1] ?? null,
      getHistory: () => [...dragPerfHistory],
      clear: () => {
        dragPerfHistory.length = 0;
      },
    };
  }
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function findRootBlockFromElements(elements) {
  for (const element of elements) {
    if (!(element instanceof Element)) continue;
    const rootBlock = element.matches(ROOT_BLOCK_OUTER_SELECTOR)
      ? element
      : element.closest(ROOT_BLOCK_OUTER_SELECTOR);
    if (rootBlock instanceof HTMLElement) return rootBlock;
  }
  return null;
}

function findRootBlockNearPoint(x, y) {
  if (typeof document.elementsFromPoint !== 'function') return null;

  for (const offset of VIEWPORT_SAMPLE_Y_OFFSETS) {
    const rootBlock = findRootBlockFromElements(document.elementsFromPoint(x, y + offset));
    if (rootBlock) return rootBlock;
  }

  return null;
}

function getIndicatorRect(rootBlockOuter) {
  const innerBlock = rootBlockOuter.querySelector(ROOT_BLOCK_INNER_SELECTOR);
  const rectSource = innerBlock instanceof HTMLElement ? innerBlock : rootBlockOuter;
  const rect = rectSource.getBoundingClientRect();

  return {
    left: rect.left,
    width: rect.width,
  };
}

// 导出自定义拖拽指示器插件
export const customDropCursorPlugin = new Plugin({
  view(editorView) {
    return {
      update: (view, prevState) => {
        // 插件更新逻辑
      },
      destroy: () => {
        // 清理插件
        cleanupDropIndicator();
      }
    };
  }
});

/**
 * Tiptap 扩展注册表只接受 Extension，不能直接混入 ProseMirror Plugin。
 * 保留底层插件的独立导出用于测试，并通过这个窄包装接入编辑器生命周期。
 */
export const CustomDropCursorExtension = Extension.create({
  name: 'customDropCursor',

  addProseMirrorPlugins() {
    return [customDropCursorPlugin];
  },
});

/**
 * 创建拖拽指示器
 * @returns {HTMLElement} 拖拽指示器元素
 */
export function createDropIndicator() {
  if (!dropIndicator) {
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'custom-drop-indicator';
    // 移除所有内联样式设置，完全依赖CSS文件中的样式
    document.body.appendChild(dropIndicator);
  }
  return dropIndicator;
}

/**
 * 显示拖拽指示器
 * @param {Object} position - 位置信息
 * @param {number} position.top - 顶部位置
 */
export function showDropIndicator(position) {
  try {
    // 确保创建指示器
    const indicator = createDropIndicator();
    
    // 只设置位置相关的样式，其他样式通过CSS类应用
    indicator.style.top = `${position.top}px`;
    indicator.style.display = 'block';

    if (typeof position.width === 'number' && typeof position.left === 'number') {
      indicator.style.width = `${position.width}px`;
      indicator.style.left = `${position.left}px`;
    } else {
      // 兜底只查一个当前 DOM 中的块，避免拖拽热路径扫描 1 万个 placeholder。
      const rootBlock = document.querySelector(ROOT_BLOCK_INNER_SELECTOR);
      if (rootBlock instanceof HTMLElement) {
        const rootBlockRect = rootBlock.getBoundingClientRect();
        indicator.style.width = `${rootBlockRect.width}px`;
        indicator.style.left = `${rootBlockRect.left}px`;
      }
    }
    
    // 确保指示器可见
    indicator.style.opacity = '1';
  } catch (error) {
    console.error("显示拖拽指示器时出错:", error);
  }
}

/**
 * 隐藏拖拽指示器
 */
export function hideDropIndicator() {
  if (dropIndicator) {
    dropIndicator.style.display = 'none';
    dropIndicator.style.opacity = '0';
  }
}

/**
 * 清理拖拽指示器
 */
export function cleanupDropIndicator() {
  cancelPendingDragOverFrame();
  if (dropIndicator && dropIndicator.parentNode) {
    dropIndicator.parentNode.removeChild(dropIndicator);
    dropIndicator = null;
  }
}

function cancelPendingDragOverFrame() {
  if (pendingDragOverFrame && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(pendingDragOverFrame);
  }
  pendingDragOverFrame = 0;
  pendingDragOverSample = null;
  pendingDragOverEventCount = 0;
}

/**
 * 计算拖拽指示器位置
 * @param {MouseEvent} event - 鼠标事件
 * @returns {Object|null} 位置信息或 null
 */
export function getDropPosition(event) {
  // 中文说明：大文档虚拟化下 DOM 仍有 1 万个 placeholder。
  // 拖拽热路径不能再全量 querySelectorAll + getBoundingClientRect；
  // 这里只从鼠标附近的当前视口 DOM 取一个锚点块，视觉指示器不需要精确全局 index。
  const rootBlock = findRootBlockNearPoint(event.clientX, event.clientY);
  if (!rootBlock) return null;

  const rect = rootBlock.getBoundingClientRect();
  const indicatorRect = getIndicatorRect(rootBlock);
  const top = event.clientY < rect.top + rect.height / 2 ? rect.top : rect.bottom;

  return {
    top,
    index: -1,
    left: indicatorRect.left,
    width: indicatorRect.width,
  };
}

function processDragOverSample() {
  const sample = pendingDragOverSample;
  const eventCount = pendingDragOverEventCount;
  pendingDragOverFrame = 0;
  pendingDragOverSample = null;
  pendingDragOverEventCount = 0;

  if (!sample) return;

  const startedAt = nowMs();
  try {
    const dropPosition = getDropPosition(sample);
    if (dropPosition) {
      showDropIndicator(dropPosition);
    } else {
      hideDropIndicator();
    }

    const durationMs = nowMs() - startedAt;
    publishDragPerf({
      kind: 'dragover-frame',
      durationMs: Math.round(durationMs * 10) / 10,
      eventCount,
      hasDropPosition: Boolean(dropPosition),
    });
  } catch (error) {
    console.error("处理拖拽经过事件时出错:", error);
  }
}

function scheduleDragOverFrame(sample) {
  pendingDragOverSample = sample;
  pendingDragOverEventCount += 1;

  if (pendingDragOverFrame) return;

  if (typeof requestAnimationFrame !== 'function') {
    processDragOverSample();
    return;
  }

  pendingDragOverFrame = requestAnimationFrame(processDragOverSample);
}

/**
 * 添加全局拖拽事件监听器
 */
export function addDragEventListeners() {
  // 确保移除旧的监听器，避免重复
  removeDragEventListeners();
  
  // 添加新的监听器
  document.addEventListener('dragover', handleDragOver, { passive: false });
  document.addEventListener('dragleave', handleDragLeave);
  document.addEventListener('drop', handleDrop);
  document.addEventListener('dragend', handleDragEnd);
  
  // 创建指示器以确保它存在
  createDropIndicator();
}

/**
 * 移除全局拖拽事件监听器
 */
export function removeDragEventListeners() {
  document.removeEventListener('dragover', handleDragOver);
  document.removeEventListener('dragleave', handleDragLeave);
  document.removeEventListener('drop', handleDrop);
  document.removeEventListener('dragend', handleDragEnd);
  cancelPendingDragOverFrame();
}

/**
 * 处理拖拽经过事件
 * @param {DragEvent} event - 拖拽事件
 */
export function handleDragOver(event) {
  // 如果正在拖拽文件，则不进行干预，让特定的放置区处理。
  // 这可以防止此全局处理程序破坏应用中其他地方的文件上传功能。
  if (event.dataTransfer.types.includes('Files')) {
    return;
  }

  // 阻止默认行为
  event.preventDefault();
  event.stopPropagation();
  
  // 设置放置效果
  event.dataTransfer.dropEffect = 'move';

  // 中文说明：dragover 频率可能远高于屏幕刷新率。
  // 事件本身只做浏览器默认行为拦截，DOM 命中测试与 getBoundingClientRect
  // 合并到下一帧处理，避免拖拽时把主线程卡在连续 layout/hit-test 上。
  scheduleDragOverFrame({
    clientX: event.clientX,
    clientY: event.clientY,
  });
}

/**
 * 处理拖拽离开事件
 * @param {DragEvent} event - 拖拽事件
 */
export function handleDragLeave(event) {
  // 检查是否离开了编辑器区域
  const editorContent = document.querySelector('.editor-content');
  if (editorContent && !editorContent.contains(event.relatedTarget)) {
    cancelPendingDragOverFrame();
    hideDropIndicator();
  }
}

/**
 * 处理放置事件
 * @param {DragEvent} event - 拖拽事件
 */
export function handleDrop(event) {
  cancelPendingDragOverFrame();
  hideDropIndicator();
}

/**
 * 处理拖拽结束事件
 * @param {DragEvent} event - 拖拽事件
 */
export function handleDragEnd(event) {
  cancelPendingDragOverFrame();
  hideDropIndicator();
}

// 导出所有函数
export default {
  createDropIndicator,
  showDropIndicator,
  hideDropIndicator,
  cleanupDropIndicator,
  getDropPosition,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  addDragEventListeners,
  removeDragEventListeners
};
