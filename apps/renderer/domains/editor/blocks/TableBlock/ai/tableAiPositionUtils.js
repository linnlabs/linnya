/**
 * tableAiPositionUtils.js
 * 
 * 此文件包含与表格AI功能交互相关的位置计算和数据提取工具函数。
 * 主要用于计算AI输入组件的位置和从表格选区中提取列引用信息。
 * 
 * 依赖：
 * - @tiptap/pm/tables 中的 CellSelection
 * - 表格位置和内容工具函数
 */

import { CellSelection } from '@tiptap/pm/tables';
import { getTableSelectionContent } from '../utils/tableContentUtils';
import { cellPositionToCoordinate as tableToExcelCoordinate } from '../position/tableCoordinateUtils';
import { selectedRect } from '@tiptap/pm/tables';
import { getTableMap } from '../position/tableMapUtils';

/**
 * 计算表格AI输入框的理想位置（默认在选区下方）
 *
 * @param {import('prosemirror-view').EditorView} editorView - ProseMirror 编辑器视图实例
 * @param {import('prosemirror-state').Selection} selection - 当前的选区对象
 * @returns {{top: number, left: number, bottom: number, targetColumn: {index: number, exists: boolean}} | null} 返回位置信息和目标列信息，如果不应显示则返回 null
 */
export function calculateTableAiInputPosition(editorView, selection) {
  if (!(selection instanceof CellSelection) || !editorView.editable) {
    return null;
  }

  // 获取表格和选区信息
  const tableNode = selection.$anchorCell.node(-1); // 获取表格节点
  if (!tableNode) return null;

  try {
    // 获取选区的DOM元素
    const fromPos = selection.$anchorCell.pos;
    const toPos = selection.$headCell.pos;
    
    // 计算选区的边界框
    const startCoords = editorView.coordsAtPos(fromPos);
    const endCoords = editorView.coordsAtPos(toPos);
    
    const selectionRect = {
      top: Math.min(startCoords.top, endCoords.top),
      bottom: Math.max(startCoords.bottom, endCoords.bottom),
      left: Math.min(startCoords.left, endCoords.left),
      right: Math.max(startCoords.right, endCoords.right)
    };
    
    // 计算AI输入框的初始位置（在选区下方居中）
    const containerWidth = 400; // 输入框的预估宽度
    const containerHeight = 300; // 输入框的预估高度
    const padding = 10;
    
    // 获取视口信息
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    
    // 视口的实际范围（考虑滚动）
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + viewportHeight;
    const viewportLeft = scrollLeft;
    const viewportRight = scrollLeft + viewportWidth;
    
    // 初始位置：选区下方
    let preferredTop = selectionRect.bottom + padding;
    let preferredLeft = selectionRect.left + (selectionRect.right - selectionRect.left) / 2 - containerWidth / 2;
    
    // 检查是否在视口内，如果不在则调整
    if (preferredTop + containerHeight > viewportBottom) {
      // 如果选区下方空间不够，尝试放在选区上方
      if (selectionRect.top - containerHeight - padding >= viewportTop) {
        preferredTop = selectionRect.top - containerHeight - padding;
      } else {
        // 如果上下都不够，放在视口中央
        preferredTop = viewportTop + (viewportHeight - containerHeight) / 2;
      }
    }
    
    // 确保左右位置在视口内
    if (preferredLeft < viewportLeft + padding) {
      preferredLeft = viewportLeft + padding;
    } else if (preferredLeft + containerWidth > viewportRight - padding) {
      preferredLeft = viewportRight - containerWidth - padding;
    }
    
    const position = {
      top: preferredTop,
      left: preferredLeft,
      bottom: selectionRect.bottom,
      targetColumn: determineTargetColumn(selection, tableNode)
    };
    
    return position;
  } catch (e) {
    console.error('[tableAiPositionUtils] 计算AI输入框位置出错:', e);
    return null;
  }
}

/**
 * 确定AI输出的目标列
 *
 * @param {CellSelection} selection - 表格选区
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @returns {{index: number, exists: boolean}} 目标列信息
 */
function determineTargetColumn(selection, tableNode) {
  // 获取选区的列范围
  const anchorCol = selection.$anchorCell.cellOffset;
  const headCol = selection.$headCell.cellOffset;
  
  // 确定选区最右侧的列
  const rightmostCol = Math.max(anchorCol, headCol);
  
  // 检查右侧是否还有列
  const tableWidth = tableNode.firstChild?.childCount || 0; // 假设第一行的子节点数为列数
  const targetColIndex = rightmostCol + 1; // 默认是选区右侧的第一列
  
  return {
    index: targetColIndex,
    exists: targetColIndex < tableWidth
  };
}

/**
 * 从表格选区提取列引用信息
 *
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {CellSelection} selection - 表格选区
 * @returns {{
 *   columnRefs: Array<{name: string, reference: string, range: string}>,
 *   selectionRange: string,
 *   rawRect: Rect,
 *   targetColumn: {index: number, exists: boolean},
 *   rowCount: number,
 *   columnCount: number
 * } | null} 列引用信息或null（如果提取失败）
 */
export function extractColumnReferences(state, selection) {
  if (!state || !(selection instanceof CellSelection)) {
    return null;
  }
  
  try {
    const rect = selectedRect(state);
    if (!rect) return null;
    
    const tableNode = selection.$anchorCell.node(-1);
    if (!tableNode) return null;
    
    const map = getTableMap(tableNode);
    if (!map) return null;
    
    const startRow = rect.top;
    const endRow = rect.bottom - 1;
    const startCol = rect.left;
    const endCol = rect.right - 1;
    
    const columnRefs = [];
    for (let col = startCol; col <= endCol; col++) {
      const startCoord = tableToExcelCoordinate(startRow, col);
      const endCoord = tableToExcelCoordinate(endRow, col);
      const range = `${startCoord}:${endCoord}`;
      const name = range;
      const reference = range;
      const currentColumnRect = {
        top: startRow,
        bottom: endRow + 1,
        left: col,
        right: col + 1
      };
      columnRefs.push({
        name,
        reference,
        range,
        rect: currentColumnRect
      });
    }
    
    const selectionStart = tableToExcelCoordinate(startRow, startCol);
    const selectionEnd = tableToExcelCoordinate(endRow, endCol);
    const selectionRangeString = `${selectionStart}:${selectionEnd}`;
    
    return {
      columnRefs,
      selectionRange: selectionRangeString,
      rawRect: rect,
      targetColumn: determineTargetColumn(selection, tableNode),
      rowCount: endRow - startRow + 1,
      columnCount: endCol - startCol + 1
    };
  } catch (e) {
    console.error('[tableAiPositionUtils] 提取列引用信息时出错:', e);
    return null;
  }
}

/**
 * 获取表格列标题（表头）
 * 
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @returns {string[]} 列标题数组
 */
export function getTableColumnHeaders(tableNode) {
  if (!tableNode || !tableNode.firstChild) return [];
  
  const headers = [];
  const firstRow = tableNode.firstChild;
  
  // 遍历第一行的单元格，提取内容作为表头
  firstRow.forEach((cell, _, i) => {
    let header = '';
    
    // 获取单元格内容（假设有tableCellContentBlock）
    const contentBlock = cell.firstChild;
    if (contentBlock) {
      // 收集文本内容
      contentBlock.descendants(node => {
        if (node.isText) {
          header += node.text || '';
        }
        return true;
      });
    }
    
    headers.push(header || `列${i + 1}`);
  });
  
  return headers;
} 