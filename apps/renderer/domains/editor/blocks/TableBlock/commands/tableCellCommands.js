/**
 * tableCellCommands.js
 * 
 * 提供表格单元格操作相关的命令，如合并和拆分单元格
 */

import { CellSelection, mergeCells as prosemirrorMergeCells } from 'prosemirror-tables';
import { runTableCommandChain } from './tableCommandChainRunner';
import {
  buildTableCellContentNormalizationTransaction,
  dispatchTableCellContentNormalization,
} from './tableCellContentNormalization';

/**
 * 合并选中的单元格，并确保正确的内容结构
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const mergeTableCellsCustom = (editor) => {
  if (!editor) return false;
  
  try {
    const { state, view } = editor;
    const { tr, selection } = state;
    
    // 确保在表格单元格选区中
    if (!(selection instanceof CellSelection)) {
      console.warn('[tableCellCommands] 当前不是单元格选区，无法合并单元格');
      return false;
    }
    
    // 获取选区信息
    const { $anchorCell, $headCell } = selection;
    
    // 检查是否可以合并
    if ($anchorCell.pos === $headCell.pos) {
      console.warn('[tableCellCommands] 选择了单个单元格，无需合并');
      return false;
    }
    
    // 执行合并单元格操作（直接使用prosemirror-tables的API）
    // prosemirrorMergeCells 会修改传入的 tr，不返回新的事务对象
    prosemirrorMergeCells(tr);
    
    // 在原事务上设置元数据，便于诊断一次合并触发的后续结构聚合。
    tr.setMeta('mergeCells', true);
    
    // 分发合并单元格的事务
    view.dispatch(tr);

    // 合并后的主单元格可能包含多个 tableCellContentBlock；结构不变量收口到纯规范化模块。
    Promise.resolve().then(() => {
      dispatchTableCellContentNormalization(editor);
    });
    
    // 聚焦编辑器
    editor.commands.focus();
    
    return true;
  } catch (error) {
    console.error('[tableCellCommands] mergeTableCellsCustom 错误:', error);
    return false;
  }
};

/**
 * 使用简化方式合并单元格并修复结构
 * 使用一个更简单但可能有短暂闪烁的方法
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
/*
export const mergeTableCellsSimple = (editor) => {
  console.log('[tableCellCommands] mergeTableCellsSimple function called'); 
  let currentState = editor.state; 
  if (!currentState && editor.view?.state) {
    currentState = editor.view.state;
  }
  if (!editor || !editor.schema || !currentState) { 
    return false;
  }
  try {
    if (!editor.state) {
        console.warn('[tableCellCommands:mergeTableCellsSimple] editor.state is undefined before calling prosemirrorMergeCells.');
        if (editor.view?.state) {
            console.log('[tableCellCommands:mergeTableCellsSimple] editor.view.state exists:', editor.view.state);
        } else {
            console.log('[tableCellCommands:mergeTableCellsSimple] editor.view.state is also undefined.');
        }
        return false;
    }
    const commandResult = prosemirrorMergeCells(editor.state, editor.view?.dispatch, editor.view);
    return commandResult;
  } catch (error) {
    console.error('[tableCellCommands] Error in mergeTableCellsSimple:', error);
    return false;
  }
};
*/

/**
 * 合并选中的单元格 (这是暴露给 Toolbar 使用的命令)
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const mergeCells = (editor) => {
  if (!editor || !editor.chain) { 
    console.warn('[tableCellCommands] mergeCells: editor or editor.chain is not available.'); // 保留此警告
    return false;
  }
  
  try {
    if (!editor.can().mergeCells()) {

      return false;
    }
    const result = editor.chain().focus().mergeCells().run();
    // console.log('[tableCellCommands] editor.chain().mergeCells().run() result:', result); // 清理

    if (result) {
      const normalization = buildTableCellContentNormalizationTransaction(editor.state);
      if (normalization) {
        editor.view.dispatch(normalization.tr);
      }
    }
    return result;
  } catch (error) {
    console.error('[tableCellCommands] Error running editor.chain().mergeCells():', error); // 保留此错误
    if (error instanceof RangeError && error.message.includes('mismatched transaction')) {
        console.error('[tableCellCommands] Mismatched transaction error during mergeCells. Editor state may be inconsistent.'); // 保留此错误
        if (!editor.state && editor.view?.state) {
            console.error('[tableCellCommands] Detail: editor.state is undefined but editor.view.state exists.'); // 保留此错误
        }
    }
    return false;
  }
};

/**
 * 拆分 / 粘贴 / 历史文档修复后的单元格内容规范化命令。
 * 结构规则由 tableCellContentNormalization.js 统一维护，命令层不再自己拼节点。
 */
export const fixTableCellContents = (editor) => {
  if (!editor) return false;

  try {
    dispatchTableCellContentNormalization(editor);
    return true;
  } catch (error) {
    console.error('[tableCellCommands] fixTableCellContents 错误:', error);
    return false;
  }
};

/**
 * 拆分当前单元格
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const splitCell = (editor) => {
  try {
    // 1. 先执行原生的splitCell命令
    const didSplit = runTableCommandChain(
      editor,
      'tableCellCommands:splitCell',
      (chain) => chain.splitCell()
    );
    if (!didSplit) return false;
    
    // 2. 然后修复单元格内容，使用requestAnimationFrame减少闪烁
    requestAnimationFrame(() => {
      fixTableCellContents(editor);
    });
    
    return didSplit;
  } catch (error) {
    console.error('[tableCellCommands] splitCell 错误:', error);
    return false;
  }
};

/**
 * 检查是否可以合并单元格
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否可以合并单元格
 */
export const canMergeCells = (editor) => {
  if (!editor || !editor.can) return false;
  
  try {
    return editor.can().mergeCells();
  } catch (error) {
    console.error('[tableCellCommands] canMergeCells 检查错误:', error);
    return false;
  }
};

/**
 * 检查是否可以拆分单元格
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否可以拆分单元格
 */
export const canSplitCell = (editor) => {
  if (!editor || !editor.can) return false;
  
  try {
    return editor.can().splitCell();
  } catch (error) {
    console.error('[tableCellCommands] canSplitCell 检查错误:', error);
    return false;
  }
};
