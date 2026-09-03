// src/renderer/extensions/position/index.js

// 导出所有位置相关的类和函数
export { PositionResolver } from './PositionResolver';
export { PositionCoordMapper } from './PositionCoordMapper';
export { NodeFinder } from './NodeFinder';
export { PositionUtils } from './PositionUtils';
export { calculateTargetIndex } from '../interaction/drag/DragPositionUtils';

/**
 * 创建位置工具实例
 * @param {Editor} editor - Tiptap 编辑器实例
 * @returns {PositionUtils} 位置工具实例
 */
export const createPositionUtils = (editor) => {
  return new PositionUtils(editor);
};

/**
 * 创建块查找工具实例
 * @param {Editor} editor - Tiptap 编辑器实例
 * @returns {BlockFinder} 块查找工具实例
 */
export const createBlockFinder = (editor) => {
  return new BlockFinder(editor);
}; 