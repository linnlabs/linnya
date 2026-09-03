/**
 * tableAlignCommands.js
 * 
 * 提供表格单元格对齐相关的命令函数
 */

import { CellSelection } from '@tiptap/pm/tables';
import { runTableCommandChain } from './tableCommandChainRunner';

/**
 * 设置单元格对齐方式
 * @param {string} alignment - 对齐方式：'left', 'center' 或 'right'
 * @returns {Function} 命令函数
 */
export const setCellAlignment = (alignment) => ({ tr, state, dispatch, editor }) => {
  // 检查是否为命令能力检查
  const isCanCheck = !dispatch;
  if (isCanCheck) {
    return true; // 对齐操作通常都可以执行
  }
  
  const { selection } = state;
  
  // 检查是否为表格选择
  const isCellSelection = selection instanceof CellSelection;
  
  if (isCellSelection) {
    // 对所有选中的单元格应用样式
    const trClone = state.tr;
    
    // 获取选中的单元格
    const selectedCells = [];
    selection.forEachCell((node, pos) => {
      selectedCells.push({ node, pos });
    });
    
    // 为每个选中的单元格应用对齐方式
    selectedCells.forEach(({ node, pos }) => {
      const attrs = { ...node.attrs, style: `text-align: ${alignment};` };
      trClone.setNodeMarkup(pos, null, attrs);
    });
    
    if (trClone.docChanged) {
      dispatch(trClone);
    }
  } else {
    // 仅当前单元格
    const nodePos = selection.$anchor.pos;
    const depth = selection.$anchor.depth;
    let cellPos = null;
    
    // 向上查找单元格节点
    for (let i = depth; i > 0; i--) {
      const node = selection.$anchor.node(i);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        cellPos = selection.$anchor.before(i);
        break;
      }
    }
    
    if (cellPos !== null) {
      const node = state.doc.nodeAt(cellPos);
      if (node) {
        const attrs = { ...node.attrs, style: `text-align: ${alignment};` };
        const trClone = state.tr.setNodeMarkup(cellPos, null, attrs);
        dispatch(trClone);
      }
    }
  }
  
  return true;
};

/**
 * 左对齐单元格
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const alignCellLeft = (editor) => {
  return runTableCommandChain(
    editor,
    'tableAlignCommands:alignCellLeft',
    (chain) => chain.command(setCellAlignment('left'))
  );
};

/**
 * 居中对齐单元格
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const alignCellCenter = (editor) => {
  return runTableCommandChain(
    editor,
    'tableAlignCommands:alignCellCenter',
    (chain) => chain.command(setCellAlignment('center'))
  );
};

/**
 * 右对齐单元格
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const alignCellRight = (editor) => {
  return runTableCommandChain(
    editor,
    'tableAlignCommands:alignCellRight',
    (chain) => chain.command(setCellAlignment('right'))
  );
};
