// src/renderer/extensions/annotation/commands/AnnoDeleteCommands.js
/**
 * AnnoDeleteCommands.js
 * 
 * 批注删除相关命令 - 已重构以适配 useAnnotationStore
 * 处理批注的删除和清理逻辑
 */
import { nextTick } from 'vue'; // 引入 nextTick

/**
 * 删除批注
 * @param {Object} params - 参数对象
 * @param {string} params.annotationId - 要删除的批注ID
 * @param {string} params.blockId - 批注所在的块ID (可选，主要用于日志或旧逻辑兼容)
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - (必需) 面板位置管理器实例
 * @returns {boolean} - 是否成功删除
 */
export const deleteAnnotation = async (params) => { // 改为 async
  const { annotationId, blockId, annotationStore, panelPositionManager } = params;
  
  if (!annotationId || !annotationStore || !panelPositionManager) {
    console.error(`[AnnoDeleteCommands] 删除失败: 缺少 annotationId, annotationStore 或 panelPositionManager`);
    return false;
  }
  
  try {
    // 1. 从数据源删除批注
    const removed = annotationStore.removeAnnotation(annotationId);
    
    if (!removed) {
      // 如果 store 中没有找到，可能已经被删除了，也算成功？或返回 false？
      // 这里我们假设没找到就不是"成功删除"
      console.warn(`[AnnoDeleteCommands] 从 store 删除批注 ${annotationId} 失败或未找到`);
      return false;
    }
    
    // 2. 清理位置相关资源 (使用新方法名)
    panelPositionManager.invalidateLayoutCacheForAnnotation(annotationId); // 使用正确的函数名
    
    // --- 提前获取函数引用 --- 
    const recalculateFunc = panelPositionManager?.recalculateAllPositions;
    // --- 获取结束 ---

    // 3. 触发其他面板位置重算 (异步)
    // 等待 Vue 更新 DOM (批注面板消失)
    await nextTick();
    
    // --- 更健壮的检查 --- 
    // 检查 annotations 是否是 ref，并且其 value 是否为数组且长度大于 0
    const annotationsRef = annotationStore?.annotations;
    const currentAnnotations = typeof annotationsRef?.value !== 'undefined' ? annotationsRef.value : annotationsRef;

    if (Array.isArray(currentAnnotations) && currentAnnotations.length > 0) {
        // --- 检查提前存储的函数引用 ---
        // --- 检查结束 ---

        // 传入 true 尝试让剩余面板回到理想位置
        if (typeof recalculateFunc === 'function') {
          await recalculateFunc(true);
        } else {
          // 可以在这里抛出新的错误或记录更详细的信息
        }
    } else {
    }
    // --- 检查结束 ---
    
    return true;
  } catch (error) {
    console.error(`[AnnoDeleteCommands] 删除批注 ${annotationId} 出错:`, error);
    return false;
  }
};

/**
 * 批量删除批注
 * @param {Object} params - 参数对象
 * @param {Array<string>} params.annotationIds - 批注ID数组
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - (必需) 面板位置管理器实例
 * @returns {Promise<{success: string[], failed: string[]}>} - 删除结果
 */
export const batchDeleteAnnotations = async (params) => {
  const { annotationIds, annotationStore, panelPositionManager } = params;
  
  if (!Array.isArray(annotationIds) || annotationIds.length === 0 || !annotationStore || !panelPositionManager) {
    return { success: [], failed: [] };
  }
  
  const results = {
    success: [],
    failed: []
  };
  
  // 先统一从 store 移除
  for (const annotationId of annotationIds) {
    const removed = annotationStore.removeAnnotation(annotationId);
    if (removed) {
      results.success.push(annotationId);
    } else {
      results.failed.push(annotationId);
    }
  }
  
  // 清理所有成功删除的批注的位置 (使用新方法名)
  results.success.forEach(id => {
    panelPositionManager.invalidateLayoutCacheForAnnotation(id); // 使用正确的函数名
  });
  
  // 等待 DOM 更新后，统一重新计算剩余面板位置
  await nextTick();
  // 注意：这里的检查也可能遇到 .value 是 undefined 的情况
  const remainingAnnotations = annotationStore.annotations;
  const currentRemaining = typeof remainingAnnotations?.value !== 'undefined' ? remainingAnnotations.value : remainingAnnotations;
  if (Array.isArray(currentRemaining) && currentRemaining.length > 0) {
    await panelPositionManager.recalculateAllPositions(true);
  }
  
  return results;
};

/**
 * 删除块中的所有批注
 * @param {Object} params - 参数对象
 * @param {string} params.blockId - 块ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - (必需) 面板位置管理器实例
 * @returns {Promise<{success: string[], failed: string[]}>} - 删除结果
 */
export const deleteBlockAnnotations = (params) => {
  const { blockId, annotationStore, panelPositionManager } = params;
  
  if (!blockId || !annotationStore || !panelPositionManager) {
    return Promise.resolve({ success: [], failed: [] });
  }
  
  // 找出块中的所有批注 ID
  // 注意：这里的检查也可能遇到 .value 是 undefined 的情况
  const annotationsRefToDelete = annotationStore.annotations;
  const currentAnnosToDelete = typeof annotationsRefToDelete?.value !== 'undefined' ? annotationsRefToDelete.value : annotationsRefToDelete;
  
  const annotationIdsToDelete = Array.isArray(currentAnnosToDelete) ? currentAnnosToDelete
    .filter(a => a.blockId === blockId)
    .map(a => a.id) : [];
  
  if (annotationIdsToDelete.length === 0) {
    return Promise.resolve({ success: [], failed: [] });
  }
  
  // 调用批量删除方法 (内部会调用新方法名)
  return batchDeleteAnnotations({
    annotationIds: annotationIdsToDelete,
    annotationStore,
    panelPositionManager
  });
}; 