/**
 * tableCoordinateUtils.js
 * 
 * 此文件提供表格坐标系统工具函数，用于将表格内部行列索引与Excel风格坐标（如A1、B3）互相转换。
 * 这些工具函数主要用于AI功能中定位和引用单元格，不会在常规编辑模式下显示。
 * 
 * 依赖：
 * - @tiptap/pm/tables 中的 TableMap
 * - tableMapUtils.js 中的表格映射工具
 * - tableSelectionUtils.js 中的选区工具
 * 
 * 相关工具：
 * - 基础位置解析工具：tablePositionUtils.js
 * - 选区相关工具：tableSelectionUtils.js
 * - 内容相关工具：tableContentUtils.js
 * - 导航相关工具：tableNavigationUtils.js
 */

import { TableMap } from '@tiptap/pm/tables';
import { selectedRect } from '@tiptap/pm/tables';
import { getCellOffsetAtLogicalPosition, getTableMap } from './tableMapUtils';
import { findCellAndTableInfoFromResolvedPos } from './tableSelectionUtils';

/**
 * @typedef {import('@tiptap/pm/model').Node} ProseMirrorNode
 * @typedef {import('@tiptap/pm/model').ResolvedPos} ResolvedPos
 * @typedef {import('@tiptap/pm/state').EditorState} EditorState
 * @typedef {import('@tiptap/pm/tables').TableMap} TableMapInstance
 */

/**
 * 将列索引转换为字母列标识（A, B, ..., Z, AA, AB, ...）
 * @param {number} colIndex - 列索引（从0开始）
 * @returns {string} 字母列标识
 */
export function columnIndexToLetters(colIndex) {
  if (colIndex < 0) return '';
  
  let letters = '';
  let n = colIndex;
  
  // 将数字转换为26进制的字母表示（A-Z, AA-ZZ等）
  while (n >= 0) {
    const remainder = n % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor(n / 26) - 1;
  }
  
  return letters;
}

/**
 * 将字母列标识转换为列索引
 * @param {string} letters - 字母列标识（如A, B, AA等）
 * @returns {number} 列索引（从0开始）
 */
export function lettersToColumnIndex(letters) {
  if (!letters || typeof letters !== 'string') return -1;
  
  const upperLetters = letters.toUpperCase();
  let index = 0;
  
  for (let i = 0; i < upperLetters.length; i++) {
    index = index * 26 + (upperLetters.charCodeAt(i) - 64);
  }
  
  return index - 1; // 转为0开始的索引
}

/**
 * 将行列索引转换为Excel风格的单元格坐标
 * @param {number} rowIndex - 行索引（从0开始）
 * @param {number} colIndex - 列索引（从0开始）
 * @returns {string} Excel风格坐标（如A1, B2）
 */
export function cellPositionToCoordinate(rowIndex, colIndex) {
  if (rowIndex < 0 || colIndex < 0) return '';
  
  const columnLetter = columnIndexToLetters(colIndex);
  const rowNumber = rowIndex + 1; // 转为1开始的行号
  
  return `${columnLetter}${rowNumber}`;
}

/**
 * 将Excel风格的单元格坐标转换为行列索引
 * @param {string} coordinate - Excel风格坐标（如A1, B2）
 * @returns {{rowIndex: number, colIndex: number}|null} 行列索引对象
 */
export function coordinateToCellPosition(coordinate) {
  if (!coordinate || typeof coordinate !== 'string') return null;
  
  // 匹配坐标格式：字母+数字
  const match = coordinate.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  
  const letters = match[1];
  const rowNumber = parseInt(match[2], 10);
  
  if (isNaN(rowNumber) || rowNumber <= 0) return null;
  
  const colIndex = lettersToColumnIndex(letters);
  const rowIndex = rowNumber - 1; // 转为0开始的索引
  
  return { rowIndex, colIndex };
}

/**
 * 获取表格中单元格的坐标
 * @param {ProseMirrorNode} tableNode - 表格节点
 * @param {number} tablePos - 表格节点在文档中的位置
 * @param {number} cellNodePos - 单元格节点在文档中的位置
 * @returns {string|null} Excel风格坐标（如A1, B2）
 */
export function getCellCoordinate(tableNode, tablePos, cellNodePos) {
  const map = getTableMap(tableNode);
  if (!map) return null;
  
  // 🔧 修复：使用正确的偏移量计算
  // 表格内容开始位置是 tablePos + 1
  const cellOffset = cellNodePos - (tablePos + 1);
  
  if (cellOffset < 0) {
    console.warn('[getCellCoordinate] 计算的偏移量为负数，单元格位置可能在表格内容之外');
    return null;
  }
  
  const cellIndex = map.findCell(cellOffset);
  
  if (cellIndex === undefined) return null;
  
  const { top: rowIndex, left: colIndex } = cellIndex;
  return cellPositionToCoordinate(rowIndex, colIndex);
}

/**
 * 获取表格指定坐标的单元格位置
 * @param {ProseMirrorNode} tableNode - 表格节点
 * @param {number} tablePos - 表格节点在文档中的位置
 * @param {string} coordinate - Excel风格坐标（如A1, B2）
 * @returns {number|null} 单元格在文档中的位置
 */
export function getCellPosByCoordinate(tableNode, tablePos, coordinate) {
  const cellPosition = coordinateToCellPosition(coordinate);
  if (!cellPosition) return null;
  
  const { rowIndex, colIndex } = cellPosition;
  const map = getTableMap(tableNode);
  if (!map || rowIndex >= map.height || colIndex >= map.width) return null;
  
  // 这里是“已有单元格查询”，必须走 TableMap 覆盖关系。
  // 合并单元格下，逻辑坐标和物理 cell child 下标不是一回事。
  const cellPosInTable = getCellOffsetAtLogicalPosition(map, rowIndex, colIndex);
  if (cellPosInTable === null) return null;
  
  // 计算单元格在文档中的绝对位置
  return tablePos + 1 + cellPosInTable;
}

/**
 * 获取表格区域的坐标范围
 * @param {ProseMirrorNode} tableNode - 表格节点
 * @param {Object} rect - 区域，格式为 {left, right, top, bottom}
 * @returns {{start: string, end: string}|null} 区域的开始和结束坐标（如A1:B3）
 */
export function getRegionCoordinates(tableNode, rect) {
  if (!rect || 
      typeof rect.left !== 'number' || 
      typeof rect.right !== 'number' || 
      typeof rect.top !== 'number' || 
      typeof rect.bottom !== 'number') {
    return null;
  }
  
  const startCoord = cellPositionToCoordinate(rect.top, rect.left);
  const endCoord = cellPositionToCoordinate(rect.bottom - 1, rect.right - 1);
  
  if (!startCoord || !endCoord) return null;
  
  return { 
    start: startCoord, 
    end: endCoord,
    range: `${startCoord}:${endCoord}`
  };
}

/**
 * 解析坐标范围（如A1:B3）为表格区域
 * @param {string} range - 坐标范围（如A1:B3）
 * @returns {{left: number, right: number, top: number, bottom: number}|null} 表格区域
 */
export function parseCoordinateRange(range) {
  if (!range || typeof range !== 'string') return null;
  
  const parts = range.split(':');
  if (parts.length !== 2) return null;
  
  const start = coordinateToCellPosition(parts[0]);
  const end = coordinateToCellPosition(parts[1]);
  
  if (!start || !end) return null;
  
  return {
    left: Math.min(start.colIndex, end.colIndex),
    right: Math.max(start.colIndex, end.colIndex) + 1, // 转为开区间
    top: Math.min(start.rowIndex, end.rowIndex),
    bottom: Math.max(start.rowIndex, end.rowIndex) + 1 // 转为开区间
  };
}

/**
 * 获取当前选区的坐标范围
 * @param {EditorState} state - 编辑器状态
 * @returns {{range: string, rect: Object}|null} 选区坐标范围和区域
 */
export function getSelectionCoordinates(state) {
  const { selection } = state;
  const { $from } = selection;
  
  // 验证选区是否在表格内
  const tableInfo = findCellAndTableInfoFromResolvedPos($from, state.schema.nodes.table);
  if (!tableInfo) return null;
  
  const { tableNode } = tableInfo;
  
  // 使用 selectedRect 获取表格选区矩形
  const rect = selectedRect(state);
  if (!rect) return null;
  
  // 获取坐标范围
  const coordinates = getRegionCoordinates(tableNode, rect);
  if (!coordinates) return null;
  
  return {
    ...coordinates,
    rect
  };
}

/**
 * 获取表格的列标题（如果存在表头行）
 * @param {ProseMirrorNode} tableNode - 表格节点
 * @param {boolean} hasHeaderRow - 是否有表头行
 * @returns {Object.<number, string>|null} 列索引到列标题的映射
 */
export function getColumnHeaders(tableNode, hasHeaderRow = true) {
  if (!tableNode || !hasHeaderRow) return null;
  
  const map = getTableMap(tableNode);
  if (!map || map.height === 0) return null;
  
  const headers = {};
  
  // 遍历第一行的所有单元格，提取其文本内容作为列标题
  for (let col = 0; col < map.width; col++) {
    const cellPos = getCellOffsetAtLogicalPosition(map, 0, col);
    if (cellPos === null) continue;
    const headerCell = tableNode.nodeAt(cellPos);
    
    if (headerCell) {
      // 提取单元格的文本内容
      let headerText = '';
      headerCell.descendants(node => {
        if (node.isText) {
          headerText += node.text;
        }
        return true;
      });
      
      headers[col] = headerText.trim();
    }
  }
  
  return Object.keys(headers).length > 0 ? headers : null;
}

/**
 * 统一的表格坐标管理器
 * 
 * 功能：提供统一的坐标计算、转换和管理
 * 输入：表格节点、位置信息、坐标字符串
 * 输出：标准化的坐标对象和位置信息
 * 副作用：无
 */
export class TableCoordinateManager {
  /**
   * 将矩形对象转换为坐标范围字符串
   * @param {Rect} rect - 矩形对象 {left, right, top, bottom}
   * @returns {string|null} 坐标范围字符串
   */
  static rectToRange(rect) {
    if (!rect || typeof rect.left !== 'number' || typeof rect.right !== 'number' || 
        typeof rect.top !== 'number' || typeof rect.bottom !== 'number') {
      return null;
    }
    
    const startCoord = cellPositionToCoordinate(rect.top, rect.left);
    const endCoord = cellPositionToCoordinate(rect.bottom - 1, rect.right - 1);
    
    if (!startCoord || !endCoord) return null;
    
    return `${startCoord}:${endCoord}`;
  }
  
  /**
   * 根据列插入调整坐标
   * @param {Rect} originalRect - 原始矩形
   * @param {number} insertedAt - 插入列的索引
   * @returns {Rect} 调整后的矩形
   */
  static adjustForColumnInsertion(originalRect, insertedAt) {
    if (!originalRect || typeof insertedAt !== 'number') {
      return originalRect;
    }
    
    // 如果原始区域在插入列的右侧，需要向右偏移
    if (originalRect.left >= insertedAt) {
      return {
        ...originalRect,
        left: originalRect.left + 1,
        right: originalRect.right + 1
      };
    }
    
    // 如果原始区域跨越插入列，需要扩展右边界
    if (originalRect.left < insertedAt && originalRect.right > insertedAt) {
      return {
        ...originalRect,
        right: originalRect.right + 1
      };
    }
    
    // 如果原始区域在插入列的左侧，不变
    return originalRect;
  }
  
  /**
   * 根据列删除调整坐标
   * @param {Rect} originalRect - 原始矩形
   * @param {number} deletedAt - 删除列的索引
   * @returns {Rect|null} 调整后的矩形，如果区域被完全删除则返回null
   */
  static adjustForColumnDeletion(originalRect, deletedAt) {
    if (!originalRect || typeof deletedAt !== 'number') {
      return originalRect;
    }
    
    // 如果被删除的列在区域内部
    if (originalRect.left <= deletedAt && originalRect.right > deletedAt) {
      // 如果区域只有一列且就是被删除的列
      if (originalRect.right - originalRect.left === 1) {
        return null; // 区域被完全删除
      }
      // 缩小右边界
      return {
        ...originalRect,
        right: originalRect.right - 1
      };
    }
    
    // 如果被删除的列在区域右侧，向左偏移
    if (originalRect.left > deletedAt) {
      return {
        ...originalRect,
        left: originalRect.left - 1,
        right: originalRect.right - 1
      };
    }
    
    // 如果被删除的列在区域左侧，不变
    return originalRect;
  }
  
  /**
   * 计算表格内容的正确偏移量
   * @param {number} cellNodeDocPos - 单元格节点文档位置
   * @param {number} tableStartPos - 表格节点文档位置
   * @returns {number} 相对于表格内容开始的偏移量
   */
  static calculateTableContentOffset(cellNodeDocPos, tableStartPos) {
    // 标准计算：表格内容开始位置是 tableStartPos + 1
    return cellNodeDocPos - (tableStartPos + 1);
  }
  
  /**
   * 验证坐标范围的有效性
   * @param {string} range - 坐标范围字符串
   * @returns {boolean} 是否有效
   */
  static isValidRange(range) {
    if (!range || typeof range !== 'string') return false;
    
    const rect = parseCoordinateRange(range);
    return rect !== null && 
           rect.left >= 0 && rect.top >= 0 && 
           rect.right > rect.left && rect.bottom > rect.top;
  }
  
  /**
   * 获取列引用的显示名称
   * @param {string} range - 坐标范围
   * @param {Object} [tableHeaders] - 表格表头映射
   * @returns {string} 显示名称
   */
  static getDisplayName(range, tableHeaders = null) {
    if (!range) return '';
    
    const rect = parseCoordinateRange(range);
    if (!rect) return range;
    
    // 如果是单列引用且有表头，使用表头名称
    if (rect.right - rect.left === 1 && tableHeaders && tableHeaders[rect.left]) {
      return tableHeaders[rect.left];
    }
    
    // 否则返回坐标范围
    return range;
  }
} 
