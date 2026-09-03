/**
 * tableToolbarCommands.js (封装层)
 * 
 * 此文件提供表格工具栏的命令函数，是对底层表格操作的高级封装。
 * 
 * 【重要】本文件只是一个封装层:
 * - 不包含实际的表格操作逻辑，只提供友好的API接口
 * - 真正的底层实现在 tableCoreOperations.js 文件中
 * - 通过调用 editor.chain().focus().command() 执行已注册的编辑器命令
 * 
 * 主要功能:
 * 1. 提供友好的错误处理
 * 2. 处理命令执行状态管理
 * 3. 统一的接口设计和日志输出
 */
import { runTableCommandChain } from './tableCommandChainRunner';

/**
 * 在上方插入行
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const addRowBefore = (editor) => {
  return runTableCommandChain(editor, 'tableToolbarCommands:addRowBefore', (chain) => chain.addRowBefore());
};

/**
 * 在下方插入行
 * @param {Object} editor - 编辑器实例
 * @returns {boolean} 是否成功执行
 */
export const addRowAfter = (editor) => {
  return runTableCommandChain(editor, 'tableToolbarCommands:addRowAfter', (chain) => chain.addRowAfter());
};

/**
 * 在左侧插入列
 * @param {Object} editor - 编辑器实例
 * @param {Function} [setCommandExecuting] - 设置命令执行状态的函数(可选)
 * @returns {boolean} 是否成功执行
 */
export const addColumnBefore = (editor, setCommandExecuting) => {
  if (!editor || typeof editor.chain !== 'function') {
    return runTableCommandChain(
      editor,
      'tableToolbarCommands:addColumnBefore',
      (chain) => chain.addColumnBefore()
    );
  }

  if (typeof setCommandExecuting === 'function') {
    setCommandExecuting(true);
  }
  
  try {
    return runTableCommandChain(
      editor,
      'tableToolbarCommands:addColumnBefore',
      (chain) => chain.addColumnBefore()
    );
  } finally {
    if (typeof setCommandExecuting === 'function') {
      setTimeout(() => {
        setCommandExecuting(false);
      }, 0);
    }
  }
};

/**
 * 在右侧插入列
 * @param {Object} editor - 编辑器实例
 * @param {Function} [setCommandExecuting] - 设置命令执行状态的函数(可选)
 * @returns {boolean} 是否成功执行
 */
export const addColumnAfter = (editor, setCommandExecuting) => {
  if (!editor || typeof editor.chain !== 'function') {
    return runTableCommandChain(
      editor,
      'tableToolbarCommands:addColumnAfter',
      (chain) => chain.addColumnAfter()
    );
  }

  if (typeof setCommandExecuting === 'function') {
    setCommandExecuting(true);
  }
  
  try {
    return runTableCommandChain(
      editor,
      'tableToolbarCommands:addColumnAfter',
      (chain) => chain.addColumnAfter()
    );
  } finally {
    if (typeof setCommandExecuting === 'function') {
      setTimeout(() => {
        setCommandExecuting(false);
      }, 0);
    }
  }
};
