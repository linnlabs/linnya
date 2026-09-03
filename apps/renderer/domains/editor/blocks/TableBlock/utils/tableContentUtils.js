/**
 * tableContentUtils.js
 * 
 * 此文件包含与表格内容相关的工具函数，专注于处理表格单元格内容的获取和操作。
 * 特别注意：我们的表格单元格内容被封装在 tableCellContentBlock 节点中，该节点
 * 只允许 inline* 内容，这使得内容处理相对简单但需要精确的位置计算。
 * 
 * 主要功能：
 * 1. 获取单元格内容块的位置信息
 * 2. 获取单元格内容的文本内容
 * 3. 处理新行插入时的内容位置
 * 4. 计算单元格内容的边界位置
 * 
 * 依赖：
 * - @tiptap/pm/model 中的 Node
 * - @tiptap/pm/state 中的 EditorState
 * 
 * 相关工具：
 * - 基础位置解析工具：tablePositionUtils.js
 * - TableMap 相关工具：tableMapUtils.js
 * - 选区相关工具：tableSelectionUtils.js
 * - 导航相关工具：tableNavigationUtils.js
 */

import { getCellOffsetAtLogicalPosition, getTableMap } from '../position/tableMapUtils';
import { findCellAndTableInfoFromResolvedPos } from '../position/tableSelectionUtils';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

/**
 * 获取单元格内容块（tableCellContentBlock）的起始和结束位置
 * @param {import('@tiptap/pm/model').Node} cellNode - 单元格节点（tableCell 或 tableHeader）
 * @param {number} cellPos - 单元格节点在文档中的起始位置
 * @returns {{start: number, end: number, contentSize: number}} 内容块的位置信息
 */
export function getCellContentBlockPositions(cellNode, cellPos) {
  if (!cellNode || typeof cellPos !== 'number') {
    return null;
  }

  const contentBlockNode = cellNode.firstChild;
  if (!contentBlockNode || contentBlockNode.type.name !== 'tableCellContentBlock') {
    return null;
  }

  const contentBlockStart = cellPos + 1; // 单元格节点后就是内容块
  const contentBlockEnd = contentBlockStart + contentBlockNode.nodeSize;
  const contentSize = contentBlockNode.content.size;

  return {
    start: contentBlockStart,
    end: contentBlockEnd,
    contentSize,
    // 内容实际开始位置（跳过内容块节点的开标签）
    contentStart: contentBlockStart + 1,
    // 内容实际结束位置（在内容块节点的闭标签之前）
    contentEnd: contentBlockEnd - 1
  };
}

/**
 * 获取单元格内容的文本内容
 * @param {import('@tiptap/pm/model').Node} cellNode - 单元格节点
 * @returns {string} 单元格的文本内容
 */
export function getCellTextContent(cellNode) {
  if (!cellNode) return '';
  
  try {
    const contentBlockNode = cellNode.firstChild;
    if (!contentBlockNode || contentBlockNode.type.name !== 'tableCellContentBlock') {
      return '';
    }
    
    // 安全地收集文本内容
    let text = '';
    try {
      contentBlockNode.descendants(node => {
        if (node.isText) {
          text += node.text || '';
        }
        return true;
      });
    } catch (e) {
      console.warn('[tableContentUtils] getCellTextContent: 解析文本内容出错:', e.message);
    }
    
    return text;
  } catch (e) {
    console.warn('[tableContentUtils] getCellTextContent: 处理单元格节点出错:', e.message);
    return '';
  }
}

/**
 * 计算新行中第一个单元格的内容块位置
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @param {number} tablePos - 表格在文档中的起始位置
 * @param {number} rowIndex - 新行的索引
 * @returns {{cellPos: number, contentBlockPos: number, contentStartPos: number}|null} 位置信息
 */
export function getNewRowFirstCellPositions(state, tableNode, tablePos, rowIndex) {
  const map = getTableMap(tableNode);
  if (!map || rowIndex < 0 || rowIndex >= map.height) {
    console.warn('[tableContentUtils] getNewRowFirstCellPositions: 无效参数', { 
      hasMap: !!map, rowIndex, tableHeight: map?.height 
    });
    return null;
  }

  try {
    // 读取已有逻辑格子时必须走覆盖关系，不能用 positionAt 推导结构边界。
    const firstCellOffset = getCellOffsetAtLogicalPosition(map, rowIndex, 0);
    if (firstCellOffset === null) {
      console.warn('[tableContentUtils] getNewRowFirstCellPositions: 无法解析新行第一个逻辑格子', {
        rowIndex,
        tableWidth: map.width,
        tableHeight: map.height,
      });
      return null;
    }

    // 计算单元格节点在文档中的绝对位置
    const cellPos = tablePos + 1 + firstCellOffset;
    // 获取单元格节点
    const cellNode = state.doc.nodeAt(cellPos);
    
    if (!cellNode) {
      console.warn('[tableContentUtils] getNewRowFirstCellPositions: 无法获取单元格节点', { cellPos });
      return null;
    }

    const contentBlockInfo = getCellContentBlockPositions(cellNode, cellPos);
    if (!contentBlockInfo) return null;

    return {
      cellPos,
      contentBlockPos: contentBlockInfo.start,
      contentStartPos: contentBlockInfo.contentStart
    };
  } catch (e) {
    console.error('[tableContentUtils] getNewRowFirstCellPositions 错误:', e);
    return null;
  }
}

/**
 * 计算表格中新行的插入位置
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @param {number} tablePos - 表格在文档中的起始位置
 * @returns {number} 新行的插入位置（在表格内容区的末尾）
 */
export function getNewRowInsertPosition(tableNode, tablePos) {
  if (!tableNode || typeof tablePos !== 'number') {
    console.warn('[tableContentUtils] getNewRowInsertPosition: 无效参数', { tableNode, tablePos });
    return -1;
  }
  // 表格内容区起始位置 + 内容大小 = 新行插入位置
  return tablePos + 1 + tableNode.content.size;
}

/**
 * 检查位置是否在单元格内容区域内
 * @param {import('@tiptap/pm/model').Node} cellNode - 单元格节点
 * @param {number} cellPos - 单元格节点在文档中的起始位置
 * @param {number} pos - 要检查的位置
 * @returns {boolean} 是否在内容区域内
 */
export function isPositionInCellContent(cellNode, cellPos, pos) {
  const contentInfo = getCellContentBlockPositions(cellNode, cellPos);
  if (!contentInfo) return false;
  
  // 检查位置是否在内容实际区域（不包括内容块节点的标签）
  return pos >= contentInfo.contentStart && pos <= contentInfo.contentEnd;
}

/**
 * 获取单元格内容块的大小信息
 * @param {import('@tiptap/pm/model').Node} cellNode - 单元格节点
 * @returns {{nodeSize: number, contentSize: number, isEmpty: boolean}} 大小信息
 */
export function getCellContentSizeInfo(cellNode) {
  if (!cellNode) {
    return { nodeSize: 0, contentSize: 0, isEmpty: true };
  }

  const contentBlockNode = cellNode.firstChild;
  if (!contentBlockNode || contentBlockNode.type.name !== 'tableCellContentBlock') {
    return { nodeSize: 0, contentSize: 0, isEmpty: true };
  }

  return {
    nodeSize: contentBlockNode.nodeSize,
    contentSize: contentBlockNode.content.size,
    isEmpty: contentBlockNode.content.size === 0
  };
}

/**
 * 获取表格选区中所有单元格的内容
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @returns {{textContent: string[][], cells: {row: number, col: number, pos: number, text: string}[], isSelection: boolean}} 选区内容信息
 */
export function getTableSelectionContent(state) {
  if (!state) {
    console.warn('[tableContentUtils] getTableSelectionContent: 无效参数', { state });
    return {
      textContent: [],
      cells: [],
      isSelection: false,
      error: resolveCurrentEditorMessage('editor.tableBlock.selection.invalidArguments'),
    };
  }

  const { selection } = state;
  // 同时检查类名和属性，更可靠地识别CellSelection
  const isCellSelection = 
    (selection.constructor.name.includes('CellSelection') || 
    (typeof selection.$anchorCell !== 'undefined' && typeof selection.$headCell !== 'undefined'));
  
  console.log('[tableContentUtils] 选区类型:', selection.constructor.name, '是CellSelection:', isCellSelection);
  
  // 如果是CellSelection，使用原有逻辑处理
  if (isCellSelection) {
    try {
      // 获取表格节点和位置
      const tableNode = selection.$anchorCell.node(-1);
      const tablePos = selection.$anchorCell.start(-1) - 1;
      
      console.log('[tableContentUtils] 表格位置:', tablePos);
      
      const map = getTableMap(tableNode);
      if (!map) {
        console.warn('[tableContentUtils] getTableSelectionContent: 无法获取表格地图');
        return {
          textContent: [],
          cells: [],
          isSelection: false,
          error: resolveCurrentEditorMessage('editor.tableBlock.selection.mapUnavailable'),
        };
      }
      
      console.log('[tableContentUtils] 表格地图尺寸:', map.width, 'x', map.height);

      // 获取选区范围，注意anchorCell和headCell的pos值
      const anchorCellPos = selection.$anchorCell.pos;
      const headCellPos = selection.$headCell.pos;
      
      // 计算偏移量前先检查值
      console.log('[tableContentUtils] anchorCellPos:', anchorCellPos, 'headCellPos:', headCellPos, 'tablePos:', tablePos);
      
      // 安全地计算偏移量
      const anchorCellOffset = Math.max(0, anchorCellPos - (tablePos + 1));
      const headCellOffset = Math.max(0, headCellPos - (tablePos + 1));
      
      console.log('[tableContentUtils] 计算的偏移量 - anchor:', anchorCellOffset, 'head:', headCellOffset);

      try {
        const rect = map.rectBetween(anchorCellOffset, headCellOffset);
        
        if (!rect) {
          console.warn('[tableContentUtils] getTableSelectionContent: 无法计算选区矩形');
          return {
            textContent: [],
            cells: [],
            isSelection: false,
            error: resolveCurrentEditorMessage('editor.tableBlock.selection.rectUnavailable'),
          };
        }
        
        const { left, right, top, bottom } = rect;
        console.log('[tableContentUtils] 选区矩形:', { left, right, top, bottom });
        
        // 用于存储选区内单元格内容的二维数组
        const textContent = [];
        const cellsInfo = [];
        
        // 遍历选区内的单元格
        for (let row = top; row < bottom; row++) {
          const rowContent = [];
          
          for (let col = left; col < right; col++) {
            try {
              // 获取单元格在map中的索引
              const cellIndex = row * map.width + col;
              
              // 检查索引是否有效
              if (cellIndex < 0 || cellIndex >= map.map.length) {
                console.warn(`[tableContentUtils] 无效的cellIndex: ${cellIndex}, 跳过`);
                rowContent.push("");
                continue;
              }
              
              // 安全地调用colCount和rowCount
              let cellColCount, cellRowCount;
              try {
                const cellOffset = map.map[cellIndex];
                if (cellOffset === undefined) {
                  rowContent.push('');
                  continue;
                }
                const cellPos = tablePos + 1 + cellOffset;
                const cellNode = state.doc.nodeAt(cellPos);
                
                

              } catch (e) {
                console.warn(`[tableContentUtils] 无法获取单元格在位置(${row},${col})的colCount/rowCount:`, e.message);
                rowContent.push("");
                continue;
              }
                            
              // 获取单元格相对于表格的位置偏移
              const cellOffset = map.map[cellIndex];
              // 计算单元格在文档中的绝对位置
              const cellPos = tablePos + 1 + cellOffset;
              const cellNode = state.doc.nodeAt(cellPos);
              
              if (cellNode) {
                const text = getCellTextContent(cellNode);
                rowContent.push(text);
                
                cellsInfo.push({
                  row,
                  col,
                  pos: cellPos,
                  text
                });
              } else {
                rowContent.push("");
              }
            } catch (colError) {
              console.warn(`[tableContentUtils] 处理位置(${row},${col})时出错:`, colError.message);
              rowContent.push("");
            }
          }
          
          textContent.push(rowContent);
        }
        
        return {
          textContent,
          cells: cellsInfo,
          isSelection: true
        };
      } catch (rectError) {
        console.error('[tableContentUtils] rectBetween 错误:', rectError.message);
        return {
          textContent: [],
          cells: [],
          isSelection: false,
          error: resolveCurrentEditorMessage('editor.tableBlock.selection.rectUnavailable'),
        };
      }
    } catch (e) {
      console.error('[tableContentUtils] getTableSelectionContent 错误:', e.message);
      console.error('错误堆栈:', e.stack);
      return {
        textContent: [],
        cells: [],
        isSelection: false,
        error: resolveCurrentEditorMessage('editor.tableBlock.selection.noValidSelection'),
      };
    }
  } else {
    // 处理普通文本选区的情况
    try {
      // 尝试从当前位置查找单元格和表格信息
      const tableInfo = findCellAndTableInfoFromResolvedPos(selection.$from, state.schema.nodes.table);
      if (!tableInfo) {
        console.info('[tableContentUtils] getTableSelectionContent: 当前不是表格单元格内的选区');
        return {
          textContent: [],
          cells: [],
          isSelection: false,
          error: resolveCurrentEditorMessage('editor.tableBlock.selection.notInsideTableCell'),
        };
      }
      
      // 提取表格信息
      const { cellNode, cellPos, tableNode, tablePos } = tableInfo;
      
      // 获取单元格文本内容
      const text = getCellTextContent(cellNode);
      
      // 创建一个只包含当前单元格的结果，不计算行列位置
      return {
        textContent: [[text]],
        cells: [{
          row: 0,  // 简化：使用默认值0
          col: 0,  // 简化：使用默认值0
          pos: cellPos,
          text
        }],
        isSelection: true
      };
    } catch (e) {
      console.error('[tableContentUtils] getTableSelectionContent 普通选区处理错误:', e.message);
      console.error('错误堆栈:', e.stack);
      return {
        textContent: [],
        cells: [],
        isSelection: false,
        error: resolveCurrentEditorMessage('editor.tableBlock.selection.noValidSelection'),
      };
    }
  }
}

/**
 * 获取表格选区内容并格式化为指定格式
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {string} format - 输出格式，支持 'csv', 'json', 'markdown', 'raw'
 * @param {Object} options - 格式化选项
 * @param {boolean} options.prettyPrint - 是否美化输出（仅JSON）
 * @returns {{formatted: string, raw: Object, isSelection: boolean, error: string}} 格式化后的内容
 */
export function getFormattedTableSelectionContent(state, format = 'json', options = {}) {
  const defaultOptions = {
    prettyPrint: true
  };
  
  const opts = { ...defaultOptions, ...options };
  const selectionContent = getTableSelectionContent(state);
  
  if (!selectionContent.isSelection || selectionContent.textContent.length === 0) {
    return { 
      formatted: "", 
      raw: selectionContent, 
      isSelection: selectionContent.isSelection,
      error: selectionContent.error || resolveCurrentEditorMessage('editor.tableBlock.selection.noValidSelection')
    };
  }
  
  const { textContent, cells } = selectionContent;
  let formatted = "";
  
  try {
    // 根据指定格式进行转换
    switch (format.toLowerCase()) {
      case 'csv':
        formatted = formatAsCSV(textContent);
        break;
        
      case 'json':
        formatted = formatAsJSON(textContent, opts.prettyPrint);
        break;
        
      case 'markdown':
        formatted = formatAsMarkdown(textContent);
        break;
        
      case 'raw':
      default:
        formatted = JSON.stringify(selectionContent, null, opts.prettyPrint ? 2 : 0);
    }
  } catch (e) {
    console.error('[tableContentUtils] getFormattedTableSelectionContent 格式化错误:', e);
    return {
      formatted: resolveCurrentEditorMessage('editor.tableBlock.selection.formattingFailed'),
      raw: selectionContent,
      isSelection: true,
      error: resolveCurrentEditorMessage('editor.tableBlock.selection.formattingFailed')
    };
  }
  
  return {
    formatted,
    raw: selectionContent,
    isSelection: true,
    error: null
  };
}

/**
 * 将表格数据格式化为CSV字符串
 * @param {string[][]} data - 表格数据
 * @returns {string} 格式化后的CSV
 */
function formatAsCSV(data) {
  const rows = [];
  
  // 添加数据行
  for (const row of data) {
    rows.push(row.map(escapeCSVField).join(','));
  }
  
  return rows.join('\n');
}

/**
 * 转义CSV字段中的特殊字符
 * @param {string} field - 字段内容
 * @returns {string} 转义后的内容
 */
function escapeCSVField(field) {
  if (field === null || field === undefined) return '';
  
  const stringField = String(field);
  // 如果字段包含逗号、双引号或换行符，需要用双引号包裹
  if (/[",\n\r]/.test(stringField)) {
    // 将字段中的双引号替换为两个双引号
    return '"' + stringField.replace(/"/g, '""') + '"';
  }
  return stringField;
}

/**
 * 将表格数据格式化为JSON字符串
 * @param {string[][]} data - 表格数据
 * @param {boolean} prettyPrint - 是否美化输出
 * @returns {string} 格式化后的JSON
 */
function formatAsJSON(data, prettyPrint) {
  // 直接使用二维数组
  return JSON.stringify(data, null, prettyPrint ? 2 : 0);
}

/**
 * 将表格数据格式化为Markdown表格
 * @param {string[][]} data - 表格数据
 * @returns {string} 格式化后的Markdown表格
 */
function formatAsMarkdown(data) {
  if (data.length === 0) return '';
  
  const rows = [];
  
  // 添加数据行
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    // 确保每个单元格都有值，避免表格错位
    const cells = row.map(cell => cell || '');
    rows.push(`| ${cells.join(' | ')} |`);
    
    // 第一行后添加分隔行
    if (i === 0) {
      rows.push(`| ${Array(row.length).fill('---').join(' | ')} |`);
    }
  }

  return rows.join('\n');
}
