import { TableMap } from '@tiptap/pm/tables';
import { TextSelection } from 'prosemirror-state';
// 导入从本文件分离出去的工具函数
import { getTableMap, getCellInfoFromTableMap } from './tableMapUtils';
import { isInTableCellByResolvedPos, getResolvedSelection, findCellAndTableInfoFromResolvedPos } from './tableSelectionUtils';
import { getNewRowInsertPosition } from '../utils/tableContentUtils';
import { handleArrowUpNavigation, getNextCellPosition } from './tableNavigationUtils';

/**
 * @typedef {import('@tiptap/pm/model').ResolvedPos} ResolvedPos
 * @typedef {import('@tiptap/pm/model').Node} ProseMirrorNode
 * @typedef {import('@tiptap/pm/state').EditorState} EditorState
 * @typedef {import('@tiptap/pm/tables').TableMap} TableMapInstance
 * @typedef {import('@tiptap/pm/model').NodeType} NodeType
 */

/**
 * tablePositionUtils.js
 * 
 * 此文件包含基础的表格位置解析工具函数，用于处理表格节点和位置的基本操作。
 * 主要功能：
 * 1. 获取 RootBlock 相关信息
 * 2. 获取节点在指定位置的信息
 * 3. 获取父节点信息
 * 
 * 依赖：
 * - @tiptap/pm/model 中的 ResolvedPos, Node
 * - @tiptap/pm/state 中的 EditorState
 * 
 * 相关工具：
 * - TableMap 相关工具：tableMapUtils.js
 * - 选区相关工具：tableSelectionUtils.js
 * - 内容相关工具：tableContentUtils.js
 * - 导航相关工具：tableNavigationUtils.js
 */

/**
 * 获取当前节点所在的 RootBlock 信息
 * @param {ResolvedPos} $pos - 解析后的位置对象
 * @returns {{node: ProseMirrorNode, pos: number, depth: number}|null}
 */
export function getCurrentRootBlockInfo($pos) {
  if (!$pos) return null;
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'rootBlock') {
      return {
        node,
        pos: $pos.before(d),
        depth: d
      };
    }
  }
  return null;
}

/**
 * 获取前一个 RootBlock 的信息
 * @param {EditorState} state - 编辑器状态
 * @param {ResolvedPos} $pos - 当前位置
 * @returns {{node: ProseMirrorNode, pos: number}|null}
 */
export function getPreviousRootBlockInfo(state, $pos) {
  const currentRootBlock = getCurrentRootBlockInfo($pos);
  if (!currentRootBlock) return null;
  
  const prevRootBlockCandidate = state.doc.resolve(currentRootBlock.pos).nodeBefore;
  if (prevRootBlockCandidate && prevRootBlockCandidate.type.name === 'rootBlock') {
    return {
      node: prevRootBlockCandidate,
      pos: currentRootBlock.pos - prevRootBlockCandidate.nodeSize
    };
  }
  return null;
}

/**
 * 获取文档中指定绝对位置的节点及其基本信息
 * @param {EditorState} state - 编辑器状态
 * @param {number} pos - 文档中的绝对位置
 * @returns {{
 *   node: ProseMirrorNode,
 *   $pos: ResolvedPos,
 *   type: string,
 *   start: number,
 *   end: number,
 *   depth: number
 * }|null}
 */
export function getNodeAtPosInfo(state, pos) {
  if (pos < 0 || pos > state.doc.content.size) return null;
  
  const $pos = state.doc.resolve(pos);
  const node = $pos.nodeAfter || $pos.nodeBefore || state.doc.nodeAt(pos);

  if (node) {
    const nodeStart = ($pos.nodeAfter && $pos.pos === pos) ? pos : 
                     (($pos.nodeBefore && $pos.pos - node.nodeSize === pos) ? pos - node.nodeSize : 
                     (state.doc.nodeAt(pos) === node ? pos : $pos.start($pos.depth)));
    return {
      node,
      $pos,
      type: node.type.name,
      start: nodeStart,
      end: nodeStart + node.nodeSize,
      depth: $pos.depth,
    };
  }

  const directNode = state.doc.nodeAt(pos);
  if (directNode) {
      return {
          node: directNode,
          $pos,
          type: directNode.type.name,
      start: pos,
          end: pos + directNode.nodeSize,
          depth: $pos.depth,
      };
  }
  return null;
}

/**
 * 获取指定深度的父节点信息
 * @param {ResolvedPos} $resolvedPos - 解析后的位置对象
 * @param {number} [depthOffset=0] - 深度偏移量
 * @returns {{node: ProseMirrorNode, pos: number, depth: number}|null}
 */
export function getParentNodeInfo($resolvedPos, depthOffset = 0) {
  if (!$resolvedPos) return null;
  const targetAbsoluteDepth = $resolvedPos.depth - depthOffset;
  if (targetAbsoluteDepth < 0) return null;
  
  try {
    const node = $resolvedPos.node(targetAbsoluteDepth);
    const pos = $resolvedPos.start(targetAbsoluteDepth);
    return { node, pos, depth: targetAbsoluteDepth };
  } catch (e) {
    return null;
  }
}

/**
 * 获取表格单元格的详细信息
 * @param {EditorState} state - 编辑器状态
 * @param {number} posInTable - 表格内的位置
 * @returns {{
 *   $posInCell: ResolvedPos,
 *   cellNode: ProseMirrorNode,
 *   cellStartPos: number,
 *   tableNode: ProseMirrorNode,
 *   tableStartPos: number,
 *   map: TableMapInstance
 * }|null}
 */
export function getDetailedCellInfoFromDocPosition(state, posInTable) {
    const $pos = state.doc.resolve(posInTable);
  if (!isInTableCellByResolvedPos($pos)) return null;

    const tableInfo = findCellAndTableInfoFromResolvedPos($pos, state.schema.nodes.table);
  if (!tableInfo) return null;

    const { cellNode, cellPos, tableNode, tablePos } = tableInfo;
    const map = getTableMap(tableNode);
  if (!map) return null;

    const $posInCell = state.doc.resolve(Math.max(cellPos + 2, posInTable));

    return {
        $posInCell,
        cellNode,
        cellStartPos: cellPos,
        tableNode,
        tableStartPos: tablePos,
        map,
    };
}

/**
 * 获取指定文档位置的单元格的边界矩形。
 * 这对于定位与单元格相关的UI元素（如句柄或弹出窗口）至关重要。
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例。
 * @param {number} pos - 单元格起始位置的文档位置。
 * @returns {DOMRect | null} 单元格的 DOMRect，如果找不到则返回 null。
 */
export const getCellBoundingRect = (editor, pos) => {
  if (!editor || typeof pos !== 'number') {
    return null;
  }

  const {view} = editor;
  try {
    // 优先使用 view.nodeDOM(pos) 来直接获取节点对应的 DOM 元素
    const domNode = view.nodeDOM(pos);

    if (domNode && domNode.nodeType === Node.ELEMENT_NODE) {
      // 检查获取到的元素是否就是我们需要的单元格
      if (domNode.matches('td, th')) {
        return domNode.getBoundingClientRect();
      }
      // 如果不是，可能是其父级或子级，使用 closest 查找
      const closestCell = domNode.closest('td, th');
      if (closestCell) {
        return closestCell.getBoundingClientRect();
      }
    }

    // 如果 nodeDOM 失败或未找到，回退到 domAtPos 方案作为备用
    const result = view.domAtPos(pos);
    const fallbackNode = result.node;

    if (!fallbackNode) {
      return null;
    }

    const element = fallbackNode.nodeType === Node.TEXT_NODE ? fallbackNode.parentElement : fallbackNode;

    if (element && typeof element.closest === 'function') {
      const closestCell = element.closest('td, th');
      if (closestCell) {
        return closestCell.getBoundingClientRect();
      }
    }

    return null;
  } catch (error) {
    console.warn(`[getCellBoundingRect] Error finding bounding rect for pos ${pos}:`, error);
    return null;
  }
};

// 导出其他工具文件中的函数，以保持向后兼容性
export {
  getTableMap,
  getCellInfoFromTableMap,
  isInTableCellByResolvedPos,
  getResolvedSelection,
  findCellAndTableInfoFromResolvedPos,
  getNewRowInsertPosition,
  handleArrowUpNavigation,
  getNextCellPosition
};

// console.log('[tablePositionUtils.js] Loaded.'); 