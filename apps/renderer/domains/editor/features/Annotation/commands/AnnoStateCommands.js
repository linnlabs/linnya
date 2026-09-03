// src/renderer/extensions/annotation/commands/AnnoStateCommands.js
/**
 * AnnoStateCommands.js
 * 
 * 批注状态转换命令 - 已重构以适配 useAnnotationStore
 * 处理批注在不同状态之间的转换逻辑
 */

import { nextTick } from 'vue';

/**
 * 批注状态枚举 (移除 DELETED)
 */
export const AnnotationState = {
  CREATING: 'creating',   // 创建中 (如果需要)
  CONFIRMED: 'confirmed', // 已确认/查看模式
  EDITING: 'editing',     // 编辑中
  RESOLVED: 'resolved',   // 已解决
};

/**
 * 开始编辑批注
 * @param {Object} params - 参数对象
 * @param {string} params.annotationId - 批注ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @returns {boolean} - 是否成功开始编辑
 */
export const startEditingAnnotation = (params) => {
  const { annotationId, annotationStore } = params;

  if (!annotationId || !annotationStore) {
    console.error('[AnnoStateCommands] 开始编辑失败: 缺少 annotationId 或 annotationStore');
    return false;
  }

  try {
    // 直接调用 store 的更新方法
    const success = annotationStore.updateAnnotation(annotationId, {
      state: AnnotationState.EDITING
    });

    if (!success) {
      console.warn(`[AnnoStateCommands] 开始编辑失败: 未找到批注 ${annotationId}`);
    }
    return success;
  } catch (error) {
    console.error(`[AnnoStateCommands] 开始编辑批注 ${annotationId} 时出错:`, error);
    return false;
  }
};

/**
 * 取消编辑批注
 * @param {Object} params - 参数对象
 * @param {string} params.annotationId - 批注ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @returns {boolean} - 是否成功取消编辑
 */
export const cancelEditingAnnotation = (params) => {
  const { annotationId, annotationStore } = params;

  if (!annotationId || !annotationStore) {
    console.error('[AnnoStateCommands] 取消编辑失败: 缺少 annotationId 或 annotationStore');
    return false;
  }

  try {
    const annotation = annotationStore.getAnnotationById(annotationId);
    if (!annotation) {
      console.warn(`[AnnoStateCommands] 取消编辑失败: 未找到批注 ${annotationId}`);
      return false;
    }

    // 仅当状态为 EDITING 时才恢复为 CONFIRMED
    if (annotation.state === AnnotationState.EDITING) {
      const success = annotationStore.updateAnnotation(annotationId, {
        state: AnnotationState.CONFIRMED
      });
      return success;
    } else {
      return true; // 或者 false，取决于是否认为这是一个"成功"操作
    }
  } catch (error) {
    console.error(`[AnnoStateCommands] 取消编辑批注 ${annotationId} 时出错:`, error);
    return false;
  }
};

/**
 * 保存编辑的批注
 * @param {Object} params - 参数对象
 * @param {string} params.annotationId - 批注ID
 * @param {string} params.content - 新的批注内容
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {string} [params.blockId] - (可选) 块ID，用于后续可能的位置更新
 * @returns {boolean} - 是否成功保存
 */
export const saveEditAnnotation = (params) => {
  const {
    annotationId,
    content,
    annotationStore,
    blockId // 保留 blockId 以便后续可能的重叠计算等
  } = params;

  if (!annotationId || !annotationStore) {
    console.error('[AnnoStateCommands] 保存编辑失败: 缺少 annotationId 或 annotationStore');
    return false;
  }
  if (content === undefined || content === null || !content.trim()) {
    console.error('[AnnoStateCommands] 保存编辑失败: 内容为空');
    // 可以考虑是否允许保存空内容，或者在这里取消编辑
    // return cancelEditingAnnotation(params);
    return false;
  }

  try {
    // 更新内容和状态
    const success = annotationStore.updateAnnotation(annotationId, {
      content: content,
      state: AnnotationState.CONFIRMED // 保存后回到查看状态
    });

    if (!success) {
      console.warn(`[AnnoStateCommands] 保存编辑失败: 未找到批注 ${annotationId}`);
    } else {
      // 在 nextTick 后触发位置相关的更新 (如果需要)
      nextTick(() => {
        const panelPosManager = params.panelPositionManager; // 假设从参数传入
        if (panelPosManager && blockId) {
          try {
             panelPosManager.invalidateLayoutCacheForAnnotation(annotationId); // 1. 使缓存失效
             panelPosManager.recalculateAllPositions(true); // 2. 重新计算 (true: 尝试回到理想位置)
          } catch(err) {
             console.error('[AnnoStateCommands] 更新位置时出错:', err)
          };
        }
      });
    }
    return success;
  } catch (error) {
    console.error(`[AnnoStateCommands] 保存编辑批注 ${annotationId} 时出错:`, error);
    return false;
  }
};

/**
 * 设置批注为已解决状态
 * @param {Object} params - 参数对象
 * @param {string} params.annotationId - 批注ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @returns {boolean} - 是否成功设置
 */
export const resolveAnnotation = (params) => {
  const { annotationId, annotationStore } = params;

  if (!annotationId || !annotationStore) {
    console.error('[AnnoStateCommands] 标记为已解决失败: 缺少 annotationId 或 annotationStore');
    return false;
  }

  try {
    const success = annotationStore.updateAnnotation(annotationId, {
      state: AnnotationState.RESOLVED
    });
     if (!success) {
       console.warn(`[AnnoStateCommands] 标记为已解决失败: 未找到批注 ${annotationId}`);
     }
    return success;
  } catch (error) {
    console.error(`[AnnoStateCommands] 标记批注 ${annotationId} 为已解决时出错:`, error);
    return false;
  }
};

/**
 * 重新打开已解决的批注
 * @param {Object} params - 参数对象
 * @param {string} params.annotationId - 批注ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @returns {boolean} - 是否成功重新打开
 */
export const reopenAnnotation = (params) => {
  const { annotationId, annotationStore } = params;

  if (!annotationId || !annotationStore) {
    console.error('[AnnoStateCommands] 重新打开失败: 缺少 annotationId 或 annotationStore');
    return false;
  }

  try {
     const annotation = annotationStore.getAnnotationById(annotationId);
     if (!annotation) {
       console.warn(`[AnnoStateCommands] 重新打开失败: 未找到批注 ${annotationId}`);
       return false;
     }

     // 仅当状态为 RESOLVED 时才恢复为 CONFIRMED
     if (annotation.state === AnnotationState.RESOLVED) {
       const success = annotationStore.updateAnnotation(annotationId, {
         state: AnnotationState.CONFIRMED
       });
       return success;
     } else {
       return true; // 或 false
     }
  } catch (error) {
    console.error(`[AnnoStateCommands] 重新打开批注 ${annotationId} 时出错:`, error);
    return false;
  }
}; 