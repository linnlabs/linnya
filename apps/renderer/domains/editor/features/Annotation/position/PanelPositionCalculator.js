// src/renderer/extensions/annotation/position/PanelPositionCalculator.js
/**
 * PanelPositionCalculator.js (已重构)
 *
 * 批注面板位置计算模块
 * 负责计算批注面板的初始位置、触发重叠处理
 * 使用 annotationStore 作为数据源和更新目标
 */

// 移除 ref
import { nextTick } from 'vue'; // 引入 nextTick
import { createPanelOverlapDetector } from './PanelOverlapDetector';
import { resolveAnnotationRootBlockId } from '../functions/rootBlockIdResolver';
import { calculateAnnotationPanelIdealPosition } from './calculateAnnotationPanelIdealPosition';
// import { createPanelFinder } from './PanelFinder'; // PanelFinder 由外部传入

// 辅助函数：确保精度一致
const standardizePrecision = (num) => Math.round(num * 10) / 10;

// 辅助函数：从 CSS 像素值解析数字
const parsePx = (cssValue) => {
    if (typeof cssValue === 'string' && cssValue.endsWith('px')) {
        return parseFloat(cssValue);
    }
    return null; // 或抛出错误，或返回 0
};


// --- 修改构造函数，接收 editor ---
export function createPanelPositionCalculator(panelFinder, annotationStore, editor) {

  // --- 修改这里：将 editor 传递给 OverlapDetector ---
  const overlapDetector = createPanelOverlapDetector(panelFinder, annotationStore, editor);

  // 计算批注面板位置 (主要用于新创建或需要强制更新位置的场景)
  // 返回 Promise<boolean> 表示是否成功处理
  const calculatePosition = async (annotationId, blockId) => { // 参数改为 annotationId 和 blockId
    // 安全检查
    if (!annotationId || !blockId || !annotationStore) {
      console.error('[PanelPositionCalculator] calculatePosition: 缺少 annotationId, blockId 或 annotationStore');
      return false;
    }
    const rootBlockId = resolveAnnotationRootBlockId(editor, blockId) || blockId;

    // 1. 计算理想位置 (数字)
    const idealPositionCSS = calculatePositionSync(rootBlockId); // 使用同步计算获取初始 CSS
    if (!idealPositionCSS) {
      console.error('[PanelPositionCalculator] 无法计算理想位置');
      return false;
    }
    const idealTop = parsePx(idealPositionCSS.top);
    const idealLeft = parsePx(idealPositionCSS.left);
    if (idealTop === null || idealLeft === null) {
       console.error('[PanelPositionCalculator] 解析理想位置CSS失败');
       return false;
    }
    const idealPosition = { top: standardizePrecision(idealTop), left: standardizePrecision(idealLeft) };

    // 2. 获取当前 annotation 对象及其状态
    const annotation = annotationStore.getAnnotationById(annotationId);
    if (!annotation) {
        console.warn(`[PanelPositionCalculator] 未在 store 中找到批注: ${annotationId}`);
        // 可能是刚创建，还没完全加入 store？Create 命令会处理初始位置更新。
        // 这里假设批注应该存在于 store 中才能计算后续位置。
        return false;
    }
    const currentState = annotation.state;
    const currentPosition = annotation.position; // { top: number, left: number }

    // 3. 决定最终位置 (保留编辑/创建状态下的位置)
    let finalPosition = {};
    const isCreatingOrEditing = currentState === 'creating' || currentState === 'editing';
    const isPositionInitialized = currentPosition && typeof currentPosition.top === 'number' && typeof currentPosition.left === 'number';

    if (isCreatingOrEditing && isPositionInitialized) {
      finalPosition = currentPosition; // 保留当前位置
    } else {
      finalPosition = idealPosition; // 使用理想位置
    }

    // 4. 更新 store 中的位置 (仅当位置变化时)
    if (!isPositionInitialized || standardizePrecision(currentPosition.top) !== finalPosition.top || standardizePrecision(currentPosition.left) !== finalPosition.left) {
        await annotationStore.updateAnnotation(annotationId, { position: finalPosition });
        await nextTick(); // 等待 store 更新和可能的 DOM 变化
    }

    // 5. 处理重叠 (调用 overlapDetector)
    const annotationsCount = annotationStore.annotations.value.length;
    if (annotationsCount > 0) { // 只要有面板就可能需要处理（比如单个面板恢复理想位置）
      await overlapDetector.handlePanelOverlaps(); // detector 内部会更新 store
    }

    return true;
  };

  // 同步计算位置的方法 - 保持原样，返回 CSS 字符串
  // 主要由 AnnoCreateCommands 使用获取初始位置
  const calculatePositionSync = (blockId) => {
    return calculateAnnotationPanelIdealPosition({
      blockId,
      editor,
      panelFinder,
      includePositionStyle: true,
    });
  };

  // 重新计算所有面板位置 - 委托给 detector
  const recalculateAllPanelPositions = async (resetToIdeal = true) => {
    await overlapDetector.recalculateAllPanelPositions(resetToIdeal);
  };

  // 面板位置清理 - 委托给 detector
  const cleanupPosition = (annotationId) => {
    overlapDetector.invalidateCacheForAnnotation(annotationId);
    return true;
  };

  // 处理面板重叠 - 委托给 detector
  const handlePanelOverlaps = async () => {
    await overlapDetector.handlePanelOverlaps();
    return true;
  };

  // 卸载时清理资源 - 委托给 detector
  const cleanup = () => {
    overlapDetector.cleanup();
  };

  return {
    calculatePosition, // 异步，接收 annotationId, blockId
    calculatePositionSync, // 同步，接收 blockId，返回 CSS
    recalculateAllPanelPositions,
    cleanupPosition, // 接收 annotationId
    handlePanelOverlaps,
    cleanup,
    // --- 新增：将 observer 接口从 detector 传递上来 ---
    observeBlock: overlapDetector.observeBlock,
    unobserveBlock: overlapDetector.unobserveBlock
  };
}
