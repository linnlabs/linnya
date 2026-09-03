// src/renderer/extensions/interaction/commands/BlockQueryCommands.js
/**
 * BlockQueryCommands.js
 * 将查找封装成命令
 * 提供与块查询相关的命令集，处理查找块ID、位置等操作
 * 这些命令适用于任何类型的块节点
 * 
 * 使用PositionUtils作为底层实现，将其包装为编辑器命令
 */

import { PositionUtils } from '../../position/PositionUtils';

/**
 * 获取当前选区所在块的ID
 * @param {String} blockType - 要查找的块类型名称（如'baseBlock'）
 * @returns {Function} - 返回命令函数
 */
export const getBlockId = (blockType = 'baseBlock') => ({ editor, state }) => {
  // 初始化PositionUtils
  const posUtils = new PositionUtils(editor);
  
  // 获取当前选区信息
  const { selection } = state;
  const { from } = selection;
  
  // 使用NodeFinder查找块
  const block = posUtils.finder.findBlockAt(from);
  
  // 如果找到块且类型匹配，返回其ID
  if (block && block.node && block.node.type.name === blockType) {
    return block.node.attrs.id;
  }
  
  return null;
};

/**
 * 通过位置获取块ID
 * @param {Number} pos - 文档中的位置
 * @param {String} blockType - 要查找的块类型名称（如'baseBlock'）
 * @returns {Function} - 返回命令函数
 */
export const getBlockIdAt = (pos, blockType = 'baseBlock') => ({ editor, state }) => {
  // 初始化PositionUtils
  const posUtils = new PositionUtils(editor);
  
  // 使用NodeFinder查找块
  const block = posUtils.finder.findBlockAt(pos);
  
  // 如果找到块且类型匹配，返回其ID
  if (block && block.node && block.node.type.name === blockType) {
    return block.node.attrs.id;
  }
  
  return null;
};

/**
 * 获取指定ID的块的位置
 * @param {String} id - 要查找的块ID
 * @param {String} blockType - 要查找的块类型名称（如'baseBlock'）
 * @returns {Function} - 返回命令函数
 */
export const findBlockById = (id, blockType = 'baseBlock') => ({ editor, state }) => {
  // 如果是查找rootBlock
  if (blockType === 'rootBlock') {
    const posUtils = new PositionUtils(editor);
    return posUtils.findRootBlockById(id);
  }
  
  // 查找其他类型的块
  let result = null;
  
  state.doc.descendants((node, pos) => {
    if (node.type.name === blockType && node.attrs.id === id) {
      result = { node, pos };
      return false; // 找到后停止遍历
    }
  });
  
  return result;
};

/**
 * 获取光标所在位置的所有类型块信息
 * 从最内层块到最外层按顺序返回所有节点信息
 * @returns {Function} - 返回命令函数
 */
export const getCurrentBlocksInfo = () => ({ editor, state }) => {
  // 初始化PositionUtils
  const posUtils = new PositionUtils(editor);
  
  // 获取当前选区信息
  const { selection } = state;
  const { from } = selection;
  
  // 使用getNodePath获取路径
  return posUtils.getNodePath(from);
};

/**
 * 获取当前文档中所有指定类型块的信息
 * @param {String} blockType - 要查找的块类型名称（如'baseBlock'）
 * @returns {Function} - 返回命令函数
 */
export const getAllBlocksOfType = (blockType = 'baseBlock') => ({ editor, state }) => {
  // 初始化PositionUtils
  const posUtils = new PositionUtils(editor);
  
  // 使用NodeFinder查找所有指定类型的节点
  return posUtils.finder.findAllNodesOfType(blockType);
};

/**
 * 检查位置是否在空块中
 * @param {Number} pos - 要检查的位置
 * @returns {Function} - 返回命令函数
 */
export const isEmptyBlockAt = (pos) => ({ editor }) => {
  const posUtils = new PositionUtils(editor);
  return posUtils.isInEmptyBlock(pos);
};

/**
 * 获取块的相邻块（前一个或后一个）
 * @param {String} direction - 方向 ('previous' 或 'next')
 * @param {Number} [pos] - 可选，不传则使用当前光标位置
 * @returns {Function} - 返回命令函数
 */
export const getSiblingBlock = (direction = 'next', pos = null) => ({ editor, state }) => {
  const posUtils = new PositionUtils(editor);
  
  // 如果未提供位置，使用当前光标位置
  const position = pos !== null ? pos : state.selection.from;
  
  // 获取基础块位置
  const block = posUtils.finder.findBlockAt(position);
  
  if (!block) return null;
  
  // 根据方向查找相邻块
  if (direction === 'previous') {
    return posUtils.findPreviousSibling(block.pos);
  } else {
    return posUtils.findNextSibling(block.pos);
  }
};

export default {
  getBlockId,
  getBlockIdAt,
  findBlockById,
  getCurrentBlocksInfo,
  getAllBlocksOfType,
  isEmptyBlockAt,
  getSiblingBlock
}; 