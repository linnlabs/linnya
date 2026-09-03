// src/renderer/utils/blockEventUtils.js
/**
 * 标准化并触发 'block-operation' 事件。
 * 确保 blockIds 始终为数组。
 *
 * @param {object} editor - Tiptap 编辑器实例 (需要包含 eventBus)
 * @param {string} action - 操作类型 (例如 'delete', 'move', 'copy')
 * @param {string|string[]} blockIds - 受影响的块 ID 或 ID 数组
 * @param {object} [payload={}] - 附加的特定于操作的数据
 */
export function emitBlockOperation(editor, action, blockIds, payload = {}) {
  if (!editor || !editor.eventBus || !editor.eventBus.emit) {
    console.error('[emitBlockOperation] 无法触发事件：editor 或 editor.eventBus 无效。');
    return;
  }

  if (!action) {
    console.error('[emitBlockOperation] 无法触发事件：缺少 action 类型。');
    return;
  }

  // 确保 blockIds 是一个数组
  const finalBlockIds = Array.isArray(blockIds) ? blockIds : (blockIds ? [blockIds] : []);

  // 至少需要一个 blockId 才能触发（避免无效事件）
  // 对于某些操作（如 insert），可能没有 blockId，需要根据 action 判断
  // 暂时要求 delete/move/copy 等都需要 blockIds
  if (finalBlockIds.length === 0 && ['delete', 'move', 'copy', 'split', 'merge'].includes(action)) {
      console.warn(`[emitBlockOperation] 尝试触发 '${action}' 事件，但 blockIds 为空。`);
      // 根据需要决定是否仍然触发事件
      // return; 
  }

  editor.eventBus.emit('block-operation', {
    action,
    blockIds: finalBlockIds,
    payload,
    timestamp: Date.now() // 添加时间戳方便调试
  });
}

// 可以考虑在此处也定义事件类型常量
export const BlockAction = {
  DELETE: 'delete',
  MOVE: 'move',
  COPY: 'copy',
  SPLIT: 'split',
  MERGE: 'merge',
  // ... 其他操作
};
