/**
 * tableCellWriter.js
 *
 * 表格单元格写入工具。
 *
 * 中文说明：
 * - 只负责把文本写入指定 table cell；
 * - 不解析 AI 工具输出，不维护 append tracker；
 * - 返回真实写入结果，调用方据此决定是否推进任务状态。
 */

import { getCellOffsetAtLogicalPosition, getTableMap } from '../position/tableMapUtils.js';
import { getCellContentBlockPositions } from '../utils/tableContentUtils.js';

/**
 * Inserts or appends text into a specific table cell.
 *
 * @param {import('@tiptap/core').Editor} editor - The Tiptap editor instance.
 * @param {import('@tiptap/pm/model').Node} tableNode - The table node.
 * @param {number} tablePos - The starting position of the table node.
 * @param {number} rowIndex - The 0-based row index within the table.
 * @param {number} colIndex - The 0-based column index within the table.
 * @param {string} textChunk - The text to insert or append.
 * @param {boolean} isAppend - If true, appends the text; otherwise, replaces existing content.
 * @returns {boolean} 是否成功写入。调用方必须根据返回值决定是否推进任务状态。
 */
export function insertOrAppendTextInCell(editor, tableNode, tablePos, rowIndex, colIndex, textChunk, isAppend) {
  if (!editor.view.editable) {
    console.warn('[insertOrAppendTextInCell] Editor is not editable.');
    return false;
  }

  const map = getTableMap(tableNode);
  if (!map) {
    console.error('[insertOrAppendTextInCell] Could not get TableMap.');
    return false;
  }

  if (rowIndex >= map.height || colIndex >= map.width) {
    console.error(`[insertOrAppendTextInCell] Cell (${rowIndex}, ${colIndex}) is out of table bounds.`);
    return false;
  }

  try {
    const cellOffset = getCellOffsetAtLogicalPosition(map, rowIndex, colIndex);
    if (cellOffset === null) {
      console.error(`[insertOrAppendTextInCell] Could not find cell offset for (${rowIndex}, ${colIndex}).`);
      return false;
    }
    const cellDocPos = tablePos + 1 + cellOffset;
    const cellNode = editor.state.doc.nodeAt(cellDocPos);

    if (!cellNode) {
      console.error(`[insertOrAppendTextInCell] No cell node found at (${rowIndex}, ${colIndex}).`);
      return false;
    }

    const contentPositions = getCellContentBlockPositions(cellNode, cellDocPos);
    if (!contentPositions) {
      console.error(`[insertOrAppendTextInCell] Could not get content positions for cell (${rowIndex}, ${colIndex}). Triggered by getCellContentBlockPositions returning null.`);
      return false;
    }

    const { contentStart, contentEnd, contentSize } = contentPositions;
    const tr = editor.state.tr;

    if (isAppend) {
      tr.insertText(textChunk, contentEnd);
    } else {
      if (contentSize > 0) {
        tr.delete(contentStart, contentEnd);
      }
      tr.insertText(textChunk, contentStart);
    }

    editor.view.dispatch(tr);
    return true;
  } catch (e) {
    console.error(`[insertOrAppendTextInCell] Error updating cell (${rowIndex}, ${colIndex}):`, e);
    return false;
  }
}
