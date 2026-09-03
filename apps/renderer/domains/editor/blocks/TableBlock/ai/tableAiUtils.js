/**
 * tableAiUtils.js
 * 
 * 此文件提供表格AI功能所需的工具函数，专注于表格数据的提取、转换和处理。
 * 这些工具函数主要用于支持AI批量填充和区域分析功能。
 * 
 * 依赖：
 * - tableMapUtils.js 中的表格映射工具
 * - tableSelectionUtils.js 中的选区工具
 * - tableCoordinateUtils.js 中的坐标工具
 */

import { selectedRect } from '@tiptap/pm/tables';
import { getCellOffsetAtLogicalPosition, getTableMap } from '../position/tableMapUtils.js';
import { findCellAndTableInfoFromResolvedPos } from '../position/tableSelectionUtils.js';
import { 
  getRegionCoordinates,
  cellPositionToCoordinate,
  columnIndexToLetters
} from '../position/tableCoordinateUtils.js';
import { getTableColumnHeaders, extractColumnReferences } from './tableAiPositionUtils.js';
import { getFormattedTableSelectionContent, getCellTextContent } from '../utils/tableContentUtils.js';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

export { insertOrAppendTextInCell } from './tableCellWriter.js';

/**
 * @typedef {import('@tiptap/pm/model').Node} ProseMirrorNode
 * @typedef {import('@tiptap/pm/model').ResolvedPos} ResolvedPos
 * @typedef {import('@tiptap/pm/state').EditorState} EditorState
 * @typedef {import('@tiptap/pm/tables').TableMap} TableMapInstance
 * @typedef {import('@tiptap/core').Editor} Editor - Tiptap Editor instance
 */

/**
 * @typedef {Object} AISourceDataRef
 * @property {string} refKey - The original reference key, e.g., "{{A1:A10}}" or "{{列名}}".
 * @property {string} label - The label shown in the UI, e.g., "A1:A10" or "列名".
 * @property {{top: number, bottom: number, left: number, right: number}} rect - The original rect of this reference in the table.
 */

/**
 * @typedef {Object} OutputRect
 * @property {number} top - Start row index for output.
 * @property {number} bottom - End row index for output (exclusive).
 * @property {number} left - Column index for output.
 * @property {number} right - Column index for output (exclusive, typically left + 1).
 */

/**
 * 获取表格区域内所有单元格的数据
 * @param {EditorState} state - 编辑器状态
 * @param {ProseMirrorNode} tableNode - 表格节点
 * @param {number} tablePos - 表格节点在文档中的位置
 * @param {Object} rect - 区域，格式为 {left, right, top, bottom}
 * @returns {Array<{
 *   pos: number,
 *   node: ProseMirrorNode,
 *   rowIndex: number,
 *   colIndex: number,
 *   isHeader: boolean,
 *   content: string,
 *   coordinate: string
 * }>} 区域内所有单元格的信息数组
 */
export function getCellsInRegion(state, tableNode, tablePos, rect) {
  const map = getTableMap(tableNode);
  if (!map) return [];
  
  // 确保rect边界在表格范围内
  const safeRect = {
    left: Math.max(0, rect.left),
    right: Math.min(map.width, rect.right),
    top: Math.max(0, rect.top),
    bottom: Math.min(map.height, rect.bottom)
  };
  
  const result = [];
  
  // 遍历区域内的所有单元格
  for (let row = safeRect.top; row < safeRect.bottom; row++) {
    for (let col = safeRect.left; col < safeRect.right; col++) {
      // 获取单元格在表格内的相对位置
      const cellPosInTable = getCellOffsetAtLogicalPosition(map, row, col);
      if (cellPosInTable === null) continue;
      
      // 计算单元格在文档中的绝对位置
      const cellPos = tablePos + 1 + cellPosInTable;
      const cellNode = state.doc.nodeAt(cellPos);
      
      if (!cellNode) continue;
      
      // 确定是否为表头单元格
      const isHeader = cellNode.type.spec.tableRole === 'header_cell';
      
      // 获取单元格坐标
      const coordinate = cellPositionToCoordinate(row, col);
      
      // 获取单元格文本内容
      const content = getCellTextContent(cellNode);
      
      result.push({
        pos: cellPos,
        node: cellNode,
        rowIndex: row,
        colIndex: col,
        isHeader,
        content: content.trim(),
        coordinate
      });
    }
  }
  
  return result;
}

/**
 * 提取单元格内容
 * @param {ProseMirrorNode} cellNode - 单元格节点
 * @param {'text'|'html'|'json'} format - 输出格式
 * @returns {string|Object} 单元格内容
 */
export function getCellContent(cellNode, format = 'text') {
  if (!cellNode) return format === 'json' ? {} : '';
  
  // 查找单元格内容块节点
  let contentNode = cellNode;
  cellNode.descendants((node, pos) => {
    if (node.type.name === 'tableCellContentBlock') {
      contentNode = node;
      return false; // 停止遍历
    }
    return true;
  });
  
  switch (format) {
    case 'text':
      // 使用 getCellTextContent 获取纯文本，然后 trim
      return getCellTextContent(cellNode).trim();
      
    case 'html':
      // 需要DOMSerializer，此处只返回简单文本
      return contentNode.textContent;
      
    case 'json':
      return contentNode.toJSON();
      
    default:
      return contentNode.textContent;
  }
}

/**
 * 获取表格数据为二维数组
 * @param {EditorState} state - 编辑器状态
 * @param {ProseMirrorNode} tableNode - 表格节点
 * @param {number} tablePos - 表格节点在文档中的位置
 * @param {Object} rect - 区域，格式为 {left, right, top, bottom}，如果不提供则使用整个表格
 * @returns {Array<Array<string>>} 表格数据二维数组
 */
export function getTableDataAsArray(state, tableNode, tablePos, rect = null) {
  const map = getTableMap(tableNode);
  if (!map) return [];
  
  const fullRect = rect || {
    left: 0,
    right: map.width,
    top: 0,
    bottom: map.height
  };
  
  const cells = getCellsInRegion(state, tableNode, tablePos, fullRect);
  
  // 创建二维数组结构
  const result = [];
  for (let i = 0; i < fullRect.bottom - fullRect.top; i++) {
    result.push(new Array(fullRect.right - fullRect.left).fill(''));
  }
  
  // 填充数据
  cells.forEach(cell => {
    const rowInResult = cell.rowIndex - fullRect.top;
    const colInResult = cell.colIndex - fullRect.left;
    if (rowInResult >= 0 && colInResult >= 0) {
      result[rowInResult][colInResult] = cell.content;
    }
  });
  
  return result;
}

/**
 * 将表格区域序列化为适合AI处理的格式
 * @param {EditorState} state - 编辑器状态
 * @param {ProseMirrorNode} tableNode - 表格节点
 * @param {number} tablePos - 表格节点在文档中的位置
 * @param {Object} rect - 区域，格式为 {left, right, top, bottom}
 * @param {'json'|'csv'|'markdown'} format - 输出格式
 * @returns {string|Object} 序列化后的表格数据
 */
export function serializeTableRegion(state, tableNode, tablePos, rect, format = 'json') {
  const tableData = getTableDataAsArray(state, tableNode, tablePos, rect);
  const hasHeaderRow = tableNode.attrs.withHeaderRow === true;
  
  // 获取列标题
  let headers;
  if (hasHeaderRow) {
    headers = getTableColumnHeaders(tableNode);
    if (!headers || headers.length < (tableData[0]?.length || 0)) {
       headers = tableData[0] || [];
    }
  } else {
    headers = Array.from({ length: tableData[0]?.length || 0 }, (_, i) => 
      columnIndexToLetters(rect ? rect.left + i : i)
    );
  }
  
  // 数据行（如果实际使用了表头行数据作为headers，则dataRows应相应调整）
  const dataRows = (hasHeaderRow && headers === tableData[0]) ? tableData.slice(1) : tableData;
  
  switch (format) {
    case 'json': {
      // 转换为对象数组，每行一个对象，列名为键
      return dataRows.map(row => {
        const rowObject = {};
        row.forEach((cell, index) => {
          if (index < headers.length) {
            rowObject[headers[index] || `column${index}`] = cell;
          }
        });
        return rowObject;
      });
    }
    
    case 'csv': {
      // 包含表头的CSV
      const csvRows = [
        headers.map(h => `"${(h || '').replace(/"/g, '""')}"`).join(',')
      ];
      
      dataRows.forEach(row => {
        csvRows.push(
          row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')
        );
      });
      
      return csvRows.join('\n');
    }
    
    case 'markdown': {
      // Markdown表格
      const mdRows = [
        headers.map(h => h || '').join(' | '),
        headers.map(() => '---').join(' | ')
      ];
      
      dataRows.forEach(row => {
        mdRows.push(row.map(cell => cell || '').join(' | '));
      });
      
      return mdRows.join('\n');
    }
    
    default:
      return tableData;
  }
}

/**
 * 从文档中的表格选区获取并序列化数据
 * @param {EditorState} state - 编辑器状态
 * @param {'json'|'csv'|'markdown'} format - 输出格式
 * @returns {Object} 序列化后的表格数据和选区信息
 */
export function getSerializedSelectionData(state, format = 'json') {
  const { selection } = state;
  const { $from } = selection;
  
  // 验证选区是否在表格内
  const tableInfo = findCellAndTableInfoFromResolvedPos($from, state.schema.nodes.table);
  if (!tableInfo) return null;
  
  const { tableNode, tablePos } = tableInfo;
  
  // 使用 selectedRect 获取表格选区矩形
  const rect = selectedRect(state);
  if (!rect) return null;
  
  // 获取坐标范围
  const coordinates = getRegionCoordinates(tableNode, rect);
  
  const serializedData = serializeTableRegion(state, tableNode, tablePos, rect, format);
  
  return {
    data: serializedData,
    coordinates,
    rect
  };
}

/**
 * 获取表格选区内容（用于AI批量填充或分析）
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {Object} options - 选项
 * @param {string} options.format - 输出格式 ('json', 'csv', 'markdown')
 * @param {boolean} options.withHeaders - 是否包含表头
 * @returns {Object} 选区内容和元数据
 */
export function getTableSelectionForAi(state, options = {}) {
  const defaultOptions = {
    format: 'json',
    withHeaders: true
  };
  
  if (!state) {
    return {
      success: false,
      error: resolveCurrentEditorMessage('editor.tableBlock.selection.invalidState'),
      errorCode: 'INVALID_STATE',
      data: null
    };
  }
  
  const opts = { ...defaultOptions, ...options };
  const result = getFormattedTableSelectionContent(state, opts.format, {
    withHeaders: opts.withHeaders,
    prettyPrint: true
  });

  if (!result.isSelection) {
    return {
      success: false,
      error: result.error || resolveCurrentEditorMessage('editor.tableBlock.selection.noValidSelection'),
      errorCode: 'NO_VALID_SELECTION',
      data: null
    };
  }

  if (result.raw.cells.length === 0) {
    return {
      success: false,
      error: resolveCurrentEditorMessage('editor.tableBlock.selection.emptySelection'),
      errorCode: 'EMPTY_SELECTION',
      data: null
    };
  }
  
  try {
    const selectionInfo = extractColumnReferences(state, state.selection);
    if (!selectionInfo || !selectionInfo.rawRect) {
      return {
        success: false,
        error: resolveCurrentEditorMessage('editor.tableBlock.selection.infoExtractionFailed'),
        errorCode: 'SELECTION_INFO_EXTRACTION_FAILED',
        data: null
      };
    }

    const { rowCount, columnCount, rawRect } = selectionInfo;
    
    return {
      success: true,
      data: {
        content: result.formatted,
        raw: result.raw,
        format: opts.format,
        meta: {
          rowCount: rowCount,
          columnCount: columnCount,
          cellCount: result.raw.cells.length,
          selectionRange: { 
            top: rawRect.top,
            bottom: rawRect.bottom -1,
            left: rawRect.left,
            right: rawRect.right -1
          }
        }
      }
    };
  } catch (error) {
    console.error('[tableAiUtils] getTableSelectionForAi 处理选区元数据失败:', error);
    return {
      success: false,
      error: resolveCurrentEditorMessage('editor.tableBlock.selection.metadataProcessingFailed'),
      errorCode: 'METADATA_PROCESSING_ERROR',
      data: null
    };
  }
}

// TODO: Consider adding utility functions for:
// - getCellContentAt(editor, rowIndex, colIndex): string | null (this is effectively what we started above)
// - findCellPos(editor, rowIndex, colIndex): number | null (to use with transactions)
// These might live in a separate tableCellUtils.js or similar.
