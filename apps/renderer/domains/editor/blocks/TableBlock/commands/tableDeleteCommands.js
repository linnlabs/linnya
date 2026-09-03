/**
 * tableDeleteCommands.js
 * 
 * 此文件提供表格删除相关的命令函数，专注于处理表格行列的删除操作
 */

import { runTableCommandChain } from './tableCommandChainRunner';
import { deleteTableColumnAtIndex } from './tableColumnDeletion';

/**
 * 删除当前行
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const deleteRow = (editor) => {
  return runTableCommandChain(editor, 'tableDeleteCommands:deleteRow', (chain) => chain.deleteRow());
};

/**
 * 删除当前列
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const deleteColumn = (editor) => {
  return runTableCommandChain(editor, 'tableDeleteCommands:deleteColumn', (chain) => chain.deleteColumn());
};

/**
 * 按索引删除指定列
 * @param {Object} editor - 编辑器实例
 * @param {number} tablePos - 表格节点在文档中的起始位置
 * @param {number} columnIndex - 要删除的列的索引 (0-based)
 * @returns {boolean} 是否成功执行
 */
export const deleteColumnByIndex = (editor, tablePos, columnIndex) => {
  if (!editor || typeof tablePos !== 'number' || typeof columnIndex !== 'number') {
    console.warn('[tableDeleteCommands] deleteColumnByIndex 参数无效');
    return false;
  }

  try {
    return editor.chain().focus().command(({ tr }) => {
      const result = deleteTableColumnAtIndex({
        tr,
        tablePos,
        columnIndex,
      });

      if (!result) {
        console.warn(`[tableDeleteCommands] 无法删除列，tablePos=${tablePos}, columnIndex=${columnIndex}`);
        return false;
      }
      
      return true;
    }).run();
  } catch (error) {
    console.error(`[tableDeleteCommands] deleteColumnByIndex 错误 (index: ${columnIndex}):`, error);
    return false;
  }
};
