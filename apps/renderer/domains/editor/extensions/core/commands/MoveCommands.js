// src/renderer/extensions/interaction/commands/MoveCommands.js
/**
 * 块移动命令
 *
 * 提供块的拖拽移动功能
 *
 * 使用 PositionUtils 提供的光标定位功能
 */

import { positionCursorAtBlockEndWithHandshake } from '../../../features/RenderVirtualization';

/**
 * 执行块移动操作
 *
 * @param {Object} state - ProseMirror state
 * @param {Function} dispatch - ProseMirror dispatch
 * @param {Object} sourceBlock - 源块
 * @param {Number} insertPos - 插入位置
 * @returns {Boolean} - 操作是否成功
 */
function executeBlockMove(state, dispatch, sourceBlock, insertPos) {
  try {
    if (!state?.tr || typeof dispatch !== 'function') {
      console.warn('[MoveCommands] 缺少 state.tr 或 dispatch，无法执行块移动事务');
      return false;
    }

    // 中文说明：拖拽落点提交处在用户手感路径上，避免再走 Tiptap chain 包装；
    // 这里直接构造并 dispatch ProseMirror transaction，保留原有 mapping 语义。
    const tr = state.tr;
    const from = tr.mapping.map(sourceBlock.pos);
    const to = tr.mapping.map(sourceBlock.pos + sourceBlock.node.nodeSize);
    tr.delete(from, to);

    const mappedInsertPos = tr.mapping.map(insertPos);
    tr.insert(mappedInsertPos, sourceBlock.node);

    dispatch(tr);
    return true;
  } catch (error) {
    console.error('[MoveCommands] 执行块移动事务时出错:', error);
    return false;
  }
}

/**
 * 拖拽移动块
 *
 * @param {Object} options - 移动选项
 * @param {String} options.sourceId - 源块ID
 * @param {Number} options.targetIndex - 目标位置索引
 * @param {Object} options.validationResult - 可选的验证结果
 * @returns {Function} - 返回命令函数
 */
export function dragMoveBlock(options = {}) {
  return ({ state, dispatch, editor }) => {
    const { sourceId, targetIndex, validationResult } = options;

    // 如果提供了验证结果，则使用它
    if (validationResult) {
      if (!validationResult.valid || !validationResult.needsMove) {
        return validationResult.valid;
      }

      // 使用验证结果中的数据执行移动
      const moveResult = executeBlockMove(
        state,
        dispatch,
        validationResult.sourceBlock,
        validationResult.insertPos
      );

      if (!moveResult) {
        return false;
      }

      // 使用requestAnimationFrame替代setTimeout，确保DOM更新后再定位光标
      requestAnimationFrame(() => {
        void positionCursorAtBlockEndWithHandshake(editor, sourceId, {
          temporaryPinMs: 800,
        }).then((result) => {
          if (!result.ok) {
            console.warn('[MoveCommands] 移动后恢复光标失败:', result);
          }
        });
      });

      return true;
    }

    // 如果没有提供验证结果，则向后兼容
    console.warn('[MoveCommands] 没有提供验证结果，向后兼容模式');
    return false;
  };
}

// 导出命令
export default {
  dragMoveBlock
};
