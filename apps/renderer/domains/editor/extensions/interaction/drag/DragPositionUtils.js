// src/renderer/extensions/position/DragPositionUtils.js

/**
 * DragPositionUtils.js
 * 
 * 提供拖拽相关的位置计算工具函数
 * 主要用于计算拖拽过程中的目标位置索引
 */

const ROOT_BLOCK_OUTER_SELECTOR = '.root-block-outer';
const VIEWPORT_SAMPLE_Y_OFFSETS = [0, -32, 32];

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

function readEditorRect(editor) {
  if (!editor || editor.isDestroyed || !editor.view?.dom) return null;

  const rect = editor.view.dom.getBoundingClientRect();
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right) || rect.width <= 0) {
    return null;
  }

  return rect;
}

function findRootBlockNearPoint(editor, x, y) {
  if (typeof document.elementsFromPoint !== 'function') return null;

  const editorRect = readEditorRect(editor);
  const xSamples = [x];
  if (editorRect) {
    xSamples.push(editorRect.left + editorRect.width / 2);
  }

  const uniqueXSamples = [...new Set(xSamples)];
  for (const sampleX of uniqueXSamples) {
    for (const offset of VIEWPORT_SAMPLE_Y_OFFSETS) {
      const rootBlock = findRootBlockFromElements(document.elementsFromPoint(sampleX, y + offset));
      if (rootBlock) return rootBlock;
    }
  }

  return null;
}

/**
 * 计算目标索引
 * 根据鼠标位置计算拖拽块的目标插入位置索引
 * 
 * @param {Editor} editor - 编辑器实例
 * @param {MouseEvent} event - 鼠标事件
 * @returns {number|null} 目标索引或 null
 */
export function calculateTargetIndex(editor, event) {

    if (!editor || !editor.state) {
      console.error('[DragPositionUtils] Editor or state is not available.'); // 保留错误日志
      return null;
    }
    
    const blocks = editor.state.doc.content.content;

    if (blocks.length === 0) {
        return null;
    }

    // 中文说明：虚拟化文档中有 1 万个 placeholder DOM。松手时不能全量 querySelector
    // 每个 block；目标 index 只需要鼠标所在的视口锚点块即可。
    const anchorBlock = findRootBlockNearPoint(editor, event.clientX, event.clientY);
    if (!anchorBlock) return null;

    const anchorId = anchorBlock.dataset.id;
    if (!anchorId) return null;

    const anchorIndex = blocks.findIndex((block) => block.attrs?.id === anchorId);
    if (anchorIndex < 0) return null;

    const rect = anchorBlock.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? anchorIndex : anchorIndex + 1;
  }

// 导出所有函数
export default {
  calculateTargetIndex
};
