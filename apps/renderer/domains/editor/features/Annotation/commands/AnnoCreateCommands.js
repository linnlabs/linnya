// src/renderer/extensions/annotation/commands/AnnoCreateCommands.js
/**
 * AnnoCreateCommands.js
 *
 * 批注创建相关命令 - 已适配 useAnnotationStore 和 useAnnotationLayoutManager
 * 处理批注的创建流程 (开始、取消、保存)
 */

import { nextTick } from 'vue';
import { AnnotationState } from './AnnoStateCommands'; // 引入状态枚举
import { resolveAnnotationRootBlockId } from '../functions/rootBlockIdResolver';
import { canPersistMarkdownAnnotationOnRootBlock } from '../functions/annotationDocumentState';

// 辅助函数：从 CSS 像素值解析数字
const parsePx = (cssValue) => {
    if (typeof cssValue === 'string' && cssValue.endsWith('px')) {
        const value = parseFloat(cssValue);
        return Number.isFinite(value) ? value : null;
    }
    console.error(`[AnnoCreateCommands] Failed to parse CSS value: ${cssValue}`);
    return null;
};

// 辅助函数：确保精度一致
const standardizePrecision = (num) => Math.round(num * 10) / 10;

/**
 * 开始创建新批注的流程
 * 1. 解析当前 Editor owner 内的初始位置
 * 2. 在 store 中添加状态为 'creating' 的批注
 * 3. 处理可能的重叠
 * @param {Object} params - 参数对象
 * @param {string} params.blockId - 目标块ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - useAnnotationLayoutManager 返回的实例
 * @param {string} [params.author] - (可选) 批注的作者
 * @returns {Promise<string|null>} - 创建的批注ID 或 null
 */
export const startCreatingAnnotation = async (params) => {
  let { blockId, annotationStore, panelPositionManager, author } = params; // 使用 let 允许修改

  if (!blockId || !annotationStore || !panelPositionManager) {
    console.error('[AnnoCreateCommands] 开始创建失败: 缺少 blockId, annotationStore 或 panelPositionManager');
    return null;
  }
  blockId = resolveAnnotationRootBlockId(annotationStore.editor, blockId) || blockId;
  if (!canPersistMarkdownAnnotationOnRootBlock(annotationStore.editor.state, blockId)) {
    console.warn(`[AnnoCreateCommands] 空 BaseBlock 不能创建批注: ${blockId}`);
    return null;
  }

  let annotationId = null;

  try {
    // 检查 annotations 是否可访问且为数组（或类似数组的对象）
    if (!annotationStore.annotations || typeof annotationStore.annotations.find !== 'function') {
       console.error('[AnnoCreateCommands] Critical Error: annotationStore.annotations is not accessible or not an array-like object with find method.');
       throw new Error('Invalid annotation store state: annotations is inaccessible.');
    }

    // 直接在 annotationStore.annotations (代理数组) 上调用 find
    const existingCreating = annotationStore.annotations.find(
      anno => anno.blockId === blockId && anno.state === AnnotationState.CREATING
    );

    if (existingCreating) {
      console.warn(`[AnnoCreateCommands] blockId ${blockId} 已存在创建中的批注 ${existingCreating.id}`);
      return existingCreating.id;
    }

    // 1. 计算初始位置 CSS (先计算位置，避免默认 0,0 导致滚动问题)
    const initialPositionCSS = panelPositionManager.calculateInitialPositionCSS(blockId);
    if (!initialPositionCSS) {
      console.error(`[AnnoCreateCommands] 无法解析当前 editor 的批注布局坐标: ${blockId}`);
      return null;
    }
    const parsedTop = parsePx(initialPositionCSS.top);
    const parsedLeft = parsePx(initialPositionCSS.left);
    if (parsedTop === null || parsedLeft === null) return null;
    const top = standardizePrecision(parsedTop);
    const left = standardizePrecision(parsedLeft);

    // 2. 定义要添加的数据 (直接使用计算好的位置)
    const annotationData = {
      blockId: blockId,
      content: '',
      author: author || 'User',
      state: AnnotationState.CREATING,
      position: { top, left }
    };

    // 3. 添加到 store
    // 在 try 内部赋值
    const newAnnotation = await annotationStore.addAnnotation(annotationData);

    if (!newAnnotation) {
      console.error('[AnnoCreateCommands] 添加批注到 store 失败');
      throw new Error('Failed to add annotation to store');
    }
    
    annotationId = newAnnotation.id;

    // 4. 处理重叠
    await nextTick(); // 等待 Vue 完成 DOM 更新
    if (annotationStore.annotations && typeof annotationStore.annotations.length === 'number' && annotationStore.annotations.length > 1) {
       await panelPositionManager.handleOverlapsOnly();
    }

    return annotationId; // 成功时返回 ID

  } catch (error) {
    console.error(`[AnnoCreateCommands] 开始创建批注时出错 for blockId ${blockId}:`, error);
    // 回滚：如果 annotationId 已经被赋值（即已添加到 store），则尝试移除
    if (annotationId) {
        annotationStore.removeAnnotation(annotationId);
    }
    return null; // 出错时返回 null
  }
};

/**
 * 取消创建新批注
 * 1. 从 store 中移除状态为 'creating' 的批注
 * 2. 清理其位置相关资源
 * 3. 重新计算剩余面板位置
 * @param {Object} params - 参数对象
 * @param {string} params.blockId - 目标块ID
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - useAnnotationLayoutManager 返回的实例
 * @returns {Promise<boolean>} - 是否成功取消
 */
export const cancelCreatingAnnotation = async (params) => {
  let { blockId, annotationStore, panelPositionManager } = params;

   if (!blockId || !annotationStore || !panelPositionManager) {
    console.error('[AnnoCreateCommands] 取消创建失败: 缺少 blockId, annotationStore 或 panelPositionManager');
    return false;
  }
  blockId = resolveAnnotationRootBlockId(annotationStore.editor, blockId) || blockId;

  try {
    // 找到 'creating' 状态的批注
    const creatingAnnotation = annotationStore.annotations.find(
      anno => anno.blockId === blockId && anno.state === AnnotationState.CREATING
    );

    if (!creatingAnnotation) {
      console.warn(`[AnnoCreateCommands] 取消创建失败: 未找到 blockId ${blockId} 对应的创建中批注`);
      return false;
    }

    const annotationId = creatingAnnotation.id;

    // 1. 从 store 中移除
    const removed = annotationStore.removeAnnotation(annotationId);
    if (!removed) {
       console.warn(`[AnnoCreateCommands] 尝试移除临时批注 ${annotationId} 失败`);
    }

    // 2. 清理位置相关资源 (如高度缓存)
    // 使用 layoutManager 的正确方法
    panelPositionManager.invalidateLayoutCacheForAnnotation(annotationId);

    // 3. 重新计算剩余面板的位置
    await nextTick(); // 等待DOM更新
    if (annotationStore.annotations.length > 0) {
        await panelPositionManager.recalculateAllPositions(true); // 尝试重置到理想位置
    }

    return removed; // 返回是否成功从 store 移除

  } catch (error) {
    console.error(`[AnnoCreateCommands] 取消创建批注时出错 for blockId ${blockId}:`, error);
    return false;
  }
};

/**
 * 保存（确认）新创建的批注
 * 1. 更新 store 中临时批注的内容和状态
 * 2. 重新计算所有面板位置（以处理可能的重叠或高度变化）
 * @param {Object} params - 参数对象
 * @param {string} params.blockId - 目标块ID
 * @param {string} params.content - 最终的批注内容
 * @param {Object} params.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} params.panelPositionManager - useAnnotationLayoutManager 返回的实例
 * @returns {Promise<string|null>} - 确认后的批注ID 或 null
 */
export const confirmCreatingAnnotation = async (params) => {
   let { blockId, content, annotationStore, panelPositionManager } = params;

   if (!blockId || content === undefined || content === null || !annotationStore || !panelPositionManager) {
    console.error('[AnnoCreateCommands] 确认创建失败: 缺少 blockId, content, annotationStore 或 panelPositionManager');
    return null;
  }
  blockId = resolveAnnotationRootBlockId(annotationStore.editor, blockId) || blockId;
   if (!content.trim()) {
     console.warn('[AnnoCreateCommands] 确认创建失败: 内容为空，自动取消');
     // 内容为空时，行为类似取消
     await cancelCreatingAnnotation({ blockId, annotationStore, panelPositionManager }); // await 取消操作
     return null;
   }

   if (!canPersistMarkdownAnnotationOnRootBlock(annotationStore.editor.state, blockId)) {
     console.warn(`[AnnoCreateCommands] 批注目标已变为空 BaseBlock，取消创建: ${blockId}`);
     await cancelCreatingAnnotation({ blockId, annotationStore, panelPositionManager });
     return null;
   }

   try {
     // 找到 'creating' 状态的批注
    const creatingAnnotation = annotationStore.annotations.find(
      anno => anno.blockId === blockId && anno.state === AnnotationState.CREATING
    );

    if (!creatingAnnotation) {
      console.error(`[AnnoCreateCommands] 确认创建失败: 未找到 blockId ${blockId} 对应的创建中批注`);
      return null;
    }

    const annotationId = creatingAnnotation.id;

    // 1. 更新 store 中的批注
    const success = annotationStore.updateAnnotation(annotationId, {
      content: content,
      state: AnnotationState.CONFIRMED // 状态变为 'confirmed'
    });

    if (!success) {
      console.error(`[AnnoCreateCommands] 更新批注 ${annotationId} 失败`);
      return null;
    }

    // 2. 重新计算所有面板的位置
    // 因为内容变化可能导致高度变化，进而产生新的重叠
    await nextTick(); // 等待DOM更新
    
    // 使缓存失效并重新计算位置
    panelPositionManager.invalidateLayoutCacheForAnnotation(annotationId);
    await panelPositionManager.recalculateAllPositions(true); // 尝试重置到理想位置

    return annotationId; // 返回确认后的 ID

   } catch (error) {
     console.error(`[AnnoCreateCommands] 确认创建批注时出错 for blockId ${blockId}:`, error);
    return null;
   }
};

/*
export const createAnnotation = (params) => { ... }
*/
