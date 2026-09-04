// src/renderer/extensions/annotation/commands/AnnoMoveCommands.js
/**
 * AnnoMoveCommands.js
 *
 * 批注移动相关命令
 */

// --- 辅助函数 --- 
// 辅助函数：确保精度一致
const standardizePrecision = (num) => {
  return Math.round(num * 10) / 10;
}

// 辅助函数：从 CSS 像素值解析数字
const parsePx = (cssValue) => {
  if (typeof cssValue === 'string' && cssValue.endsWith('px')) {
    const parsed = parseFloat(cssValue);
    return Number.isFinite(parsed) ? parsed : null;
  }
  console.warn(`[AnnoMoveCommands-parsePx] Failed to parse CSS value: ${cssValue}`);
  return null;
};
// --- 辅助函数结束 ---

/**
 * 更新与已移动块关联的所有批注的理想位置。
 * 当一个块被移动后，调用此命令来更新其关联批注的位置。
 *
 * @param {Object} params - 参数对象
 * @param {string} params.blockId - 已移动块的 ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - useAnnotationLayoutManager 返回的实例
 * @returns {Promise<void>}
 */
export const updateAnnotationsPositionForMovedBlock = async ({ blockId, annotationStore, panelPositionManager }) => {
  if (!blockId || !annotationStore || !panelPositionManager) {
    console.error('[AnnoMoveCommands] updateAnnotationsPositionForMovedBlock: 缺少 blockId, annotationStore 或 panelPositionManager');
    return;
  }

  // 1. 找到关联的批注
  const annotationsToUpdate = annotationStore.getAnnotationsByBlockId(blockId);
  if (!annotationsToUpdate || annotationsToUpdate.length === 0) {
    return;
  }

  // 2. 计算该块新的理想位置 CSS (通过 LayoutManager 获取)
  // LayoutManager 拥有计算 CSS 位置的逻辑
  const idealPositionCSS = panelPositionManager.calculateInitialPositionCSS(blockId);
  if (!idealPositionCSS) {
    console.error(`[AnnoMoveCommands] updateAnnotationsPositionForMovedBlock: 无法计算 blockId=${blockId} 的理想位置 CSS`);
    return;
  }

  // 3. 解析 CSS 为数字
  const parsedTop = parsePx(idealPositionCSS.top);
  const parsedLeft = parsePx(idealPositionCSS.left);
  if (parsedTop === null || parsedLeft === null) {
    console.error(`[AnnoMoveCommands] updateAnnotationsPositionForMovedBlock: 解析位置 CSS 失败 for blockId=${blockId}`);
    return;
  }
  const newTop = standardizePrecision(parsedTop);
  const newLeft = standardizePrecision(parsedLeft);

  // 4. 更新所有关联批注的位置 (在 Store 中)
  const updatePromises = annotationsToUpdate.map(annotation => {
    // 检查批注是否处于编辑或创建状态，如果是，则不应强制移动到理想位置
    // 块移动后，即使是编辑中的批注，其相对位置也需要更新
    // 这里假设块移动后，所有关联批注都应移动到新的理想位置
    return annotationStore.updateAnnotation(annotation.id, {
      position: { top: newTop, left: newLeft }
    });
  });

  try {
    await Promise.all(updatePromises);

    // --- 重要：更新位置后，需要触发重叠处理 --- 
    // 等待 Store 更新和 DOM 反应
    // import { nextTick } from 'vue'; // 如果需要在文件顶部导入
    // await nextTick(); 
    await panelPositionManager.recalculateAllPositions(false); // false表示不重置到理想位置，仅处理重叠
    // --- 重叠处理结束 --- 

  } catch (error) {
    console.error(`[AnnoMoveCommands] updateAnnotationsPositionForMovedBlock: 更新批注位置或处理重叠时出错 for blockId=${blockId}:`, error);
  }
};

/**
 * 将指定的批注移动到另一个块。
 * (此功能为接口预留，当前未完整实现)
 *
 * @param {Object} params - 参数对象
 * @param {string} params.annotationId - 要移动的批注 ID
 * @param {string} params.targetBlockId - 目标块的 ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - useAnnotationLayoutManager 返回的实例
 * @returns {Promise<boolean>} - 是否成功移动 (当前始终返回 false)
 */
export const moveAnnotationToBlock = async ({ annotationId, targetBlockId, annotationStore, panelPositionManager }) => {
  console.warn(`[AnnoMoveCommands] moveAnnotationToBlock 功能尚未完整实现。 annotationId=${annotationId}, targetBlockId=${targetBlockId}`);
  
  if (!annotationId || !targetBlockId || !annotationStore || !panelPositionManager) {
      console.error('[AnnoMoveCommands] moveAnnotationToBlock: 缺少必要参数');
      return false;
  }
  
  // 实际实现将涉及：
  // 1. 验证 annotationId 和 targetBlockId 是否有效
  // 2. 更新 annotationStore 中该批注的 blockId
  // 3. 计算并更新该批注基于 targetBlockId 的新位置
  // 4. 可能需要触发重叠处理
  
  // 占位实现
  return false; 
};
