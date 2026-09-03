/**
 * tableRowProcessing.js
 *
 * 表格 AI 的行级输入构造规则。
 *
 * 中文说明：
 * - 本文件只负责为指定行构造 prompt 与数据上下文；
 * - 批量遍历与执行时序由 app/workflows/table-fill 负责。
 */

import { getCellOffsetAtLogicalPosition, getTableMap } from '../position/tableMapUtils.js';
import { getCellTextContent } from '../utils/tableContentUtils.js';

/**
 * 为特定行构建一个数据上下文对象（JSON）。
 * @param {import('@tiptap/core').Editor} editor
 * @param {import('@tiptap/pm/model').Node} tableNode
 * @param {number} tablePos
 * @param {Array<{ refKey: string, label: string, rect: { top: number, bottom: number, left: number, right: number } }>} activeInputRefs
 * @param {number} rowIndex
 * @returns {Record<string, string>}
 */
export function getRowDataContext(editor, tableNode, tablePos, activeInputRefs, rowIndex) {
  const dataContext = {};
  if (!activeInputRefs || activeInputRefs.length === 0) {
    return dataContext;
  }

  const map = getTableMap(tableNode);
  if (!map) return dataContext;

  for (const ref of activeInputRefs) {
    const colIndex = ref.rect.left;
    const colHeader = ref.label;

    if (rowIndex >= map.height || colIndex >= map.width) {
      dataContext[colHeader] = '[数据越界]';
      continue;
    }

    try {
      const cellOffset = getCellOffsetAtLogicalPosition(map, rowIndex, colIndex);
      if (cellOffset === null) {
        dataContext[colHeader] = '[数据无法定位]';
        continue;
      }
      const cellDocPos = tablePos + 1 + cellOffset;
      const cellNode = editor.state.doc.nodeAt(cellDocPos);
      dataContext[colHeader] = cellNode ? getCellTextContent(cellNode) : '[无此单元格]';
    } catch {
      dataContext[colHeader] = '[数据提取错误]';
    }
  }
  return dataContext;
}

/**
 * 为某一行构造 prompt：把用户模板里的 `{{列名}}` 替换成该行真实单元格值。
 *
 * @param {import('@tiptap/core').Editor} editor
 * @param {import('@tiptap/pm/model').Node} tableNode
 * @param {number} tablePos
 * @param {string} userPromptTemplate
 * @param {Array<{ refKey: string, label: string, rect: { top: number, bottom: number, left: number, right: number } }>} activeInputRefs
 * @param {number} rowIndex
 * @returns {string | null}
 */
export function constructPromptForRow(editor, tableNode, tablePos, userPromptTemplate, activeInputRefs, rowIndex) {
  let promptWithData = userPromptTemplate;

  console.log(`[constructPromptForRow] 行${rowIndex + 1}的原始模板:`, JSON.stringify(userPromptTemplate));

  if (!editor || !editor.state) {
    console.error('[constructPromptForRow] Editor or editor state is not available.');
    return null;
  }
  if (!tableNode || typeof tablePos !== 'number') {
    console.error('[constructPromptForRow] tableNode and tablePos are required parameters.');
    return null;
  }

  const { doc } = editor.state;
  const map = getTableMap(tableNode);
  if (!map) {
    console.error('[constructPromptForRow] Could not get TableMap.');
    return null;
  }

  for (const ref of activeInputRefs) {
    const placeholder = `{{${ref.label}}}`;
    const colIndex = ref.rect.left;

    if (rowIndex >= map.height || colIndex >= map.width) {
      console.warn(`[constructPromptForRow] Row ${rowIndex} or Col ${colIndex} is out of table bounds (${map.height}x${map.width}). Skipping placeholder ${placeholder}.`);
      promptWithData = promptWithData.replace(new RegExp(escapeRegExp(placeholder), 'g'), '[数据越界]');
      continue;
    }

    try {
      const cellOffset = getCellOffsetAtLogicalPosition(map, rowIndex, colIndex);
      if (cellOffset === null) {
        console.warn(`[constructPromptForRow] Could not find cell position at (${rowIndex}, ${colIndex}). Skipping placeholder ${placeholder}.`);
        promptWithData = promptWithData.replace(new RegExp(escapeRegExp(placeholder), 'g'), '[数据无法定位]');
        continue;
      }
      const cellDocPos = tablePos + 1 + cellOffset;
      const cellNode = doc.nodeAt(cellDocPos);

      if (cellNode) {
        const cellText = getCellTextContent(cellNode);
        console.log(`[constructPromptForRow] 替换占位符 ${placeholder} 为值: "${cellText}"`);
        promptWithData = promptWithData.replace(new RegExp(escapeRegExp(placeholder), 'g'), `"${cellText}"`);
      } else {
        console.warn(`[constructPromptForRow] No cell node found at (${rowIndex}, ${colIndex}) resolved to pos ${cellDocPos}. Skipping placeholder ${placeholder}.`);
        promptWithData = promptWithData.replace(new RegExp(escapeRegExp(placeholder), 'g'), '[无此单元格]');
      }
    } catch (error) {
      console.error(`[constructPromptForRow] Error getting cell content for placeholder ${placeholder} at (${rowIndex}, ${colIndex}):`, error);
      promptWithData = promptWithData.replace(new RegExp(escapeRegExp(placeholder), 'g'), '[数据提取错误]');
    }
  }

  console.log(`[constructPromptForRow] 行${rowIndex + 1}替换后的最终提示:`, JSON.stringify(promptWithData));

  return promptWithData;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
