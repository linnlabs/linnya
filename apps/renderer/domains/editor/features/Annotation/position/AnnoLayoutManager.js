// src/renderer/features/Annotation/position/AnnoLayoutManager.js
/**
 * AnnoLayoutManager.js (已重构)
 *
 * 批注布局的顶层管理器
 * 负责协调 Calculator 和 Detector
 */

// import { onBeforeUnmount } from 'vue'; // 移除生命周期钩子
import { createPanelPositionCalculator } from './PanelPositionCalculator';
import { createPanelFinder } from './PanelFinder';

/**
 * 批注布局管理器的 Composable 函数
 * @param {Object} options
 * @param {Object} options.annotationStore - useAnnotationStore 返回的实例
 * @param {Object} options.editor - 编辑器实例
 * @returns {Object} 布局管理器 API
 */
export function useAnnotationLayoutManager({ annotationStore, editor }) {
  if (!annotationStore) {
    throw new Error("[useAnnotationLayoutManager] annotationStore is required.");
  }

  // 初始化依赖
  const panelFinder = createPanelFinder(editor);
  const panelPositionCalculator = createPanelPositionCalculator(panelFinder, annotationStore, editor);


  // --- 公共 API ---

  /**
   * 计算并更新指定批注的位置，并处理重叠。
   * @param {string} annotationId - 批注 ID
   * @param {string} blockId - 批注所属块 ID
   * @returns {Promise<boolean>} 是否成功处理
   */
  const calculateAndPosition = async (annotationId, blockId) => {
    return await panelPositionCalculator.calculatePosition(annotationId, blockId);
  };

  /**
   * 同步计算指定块的理想初始位置 (返回 CSS 字符串)。
   * 主要供创建命令使用。
   * @param {string} blockId - 块 ID
   * @returns {{top: string, left: string, position: string} | null} CSS 样式对象或 null
   */
  const calculateInitialPositionCSS = (blockId) => {
    return panelPositionCalculator.calculatePositionSync(blockId);
  };

  /**
   * 重新计算并更新所有当前批注面板的位置。
   * @param {boolean} [resetToIdeal=true] - 是否先将非编辑状态的面板重置到理想位置
   * @returns {Promise<void>}
   */
  const recalculateAllPositions = async (resetToIdeal = true) => {
    await panelPositionCalculator.recalculateAllPanelPositions(resetToIdeal);
  };

  /**
   * 清理与指定批注相关的布局状态（如缓存）。
   * @param {string} annotationId - 批注 ID
   */
  const invalidateLayoutCacheForAnnotation = (annotationId) => {
    panelPositionCalculator.cleanupPosition(annotationId); // Calculator's cleanupPosition should internally call detector's invalidate
  };

  /**
   * 仅处理当前面板之间的重叠，不计算或重置理想位置。
   * @returns {Promise<boolean>} 是否处理了重叠
   */
  const handleOverlapsOnly = async () => {
     return await panelPositionCalculator.handlePanelOverlaps();
  }

  /**
   * 返回当前 editor owner 对应的批注挂载层。
   *
   * 中文说明：面板 Teleport 和位置计算必须共享同一个真实 DOM 元素，不能各自再用
   * document.querySelector 猜测目标，否则多层 shell / 多 surface 下会再次坐标串台。
   */
  const getPanelMountElement = () => panelFinder.findAnnotationLayer();

  /**
   * 返回当前 editor owner 对应的布局视口。
   *
   * 中文说明：容器尺寸变化监听也必须使用 PanelFinder 已确认的 owner，不能由调用方
   * 再通过 closest/querySelector 猜测 shell，否则会重新引入嵌套 Workspace shell 串台。
   */
  const getLayoutViewportElement = () => panelFinder.findEditorShell();




  /**
   * 清理布局管理器及其依赖项
   * 这个方法应该在 EditorContext 卸载前被外部调用
   */
  const cleanup = () => {
    panelPositionCalculator.cleanup(); // 清理 Calculator 及其依赖 (OverlapDetector)
  };

  // 返回公共 API，包含 cleanup 方法
  return {
    calculateAndPosition,
    calculateInitialPositionCSS,
    recalculateAllPositions,
    invalidateLayoutCacheForAnnotation,
    handleOverlapsOnly,
    getPanelMountElement,
    getLayoutViewportElement,
    cleanup, // 暴露 cleanup 方法
    // --- 新增：将 observer 接口从 calculator 传递上来 ---
    observeBlock: panelPositionCalculator.observeBlock,
    unobserveBlock: panelPositionCalculator.unobserveBlock
  };
}
