// src/renderer/extensions/annotation/position/PanelOverlapDetector.js
/**
 * PanelOverlapDetector.js (已重构)
 *
 * 面板重叠检测器 - 负责检测和处理面板重叠情况
 * 使用 annotationStore 作为数据源和更新目标
 */

import { nextTick } from 'vue';
import { getBlockPosIndex } from '../../../extensions/position/blockPosIndex';
import { resolveAnnotationRootBlockId } from '../functions/rootBlockIdResolver';
import { calculateAnnotationPanelIdealPosition } from './calculateAnnotationPanelIdealPosition';

// 辅助函数：确保精度一致
const standardizePrecision = (num) => Math.round(num * 10) / 10;

// 修改构造函数，接收 annotationStore 和 editor 参数
export function createPanelOverlapDetector(panelFinder, annotationStore, editor) {
  // 最小面板间隔
  const MIN_PANEL_GAP = 10;

  // 内部状态/缓存 (如果需要，例如缓存高度)
  const panelHeightCache = new Map(); // 使用 Map 缓存高度 <annotationId, height>
  
  // --- IntersectionObserver 逻辑 ---
  const visibleBlockIds = new Set();
  const observedBlockElements = new Set();
  let observer = null;
  let observerRoot = null;

  const handleIntersection = (entries) => {
    entries.forEach(entry => {
      const blockId = entry.target.dataset.id;
      if (blockId) {
        if (entry.isIntersecting) {
          visibleBlockIds.add(blockId);
        } else {
          visibleBlockIds.delete(blockId);
        }
      }
    });
  };

  const ensureObserver = () => {
    const nextRoot = panelFinder.findEditorShell();
    if (!nextRoot) return null;
    if (observer && observerRoot === nextRoot) return observer;

    observer?.disconnect();
    visibleBlockIds.clear();
    observerRoot = nextRoot;
    observer = new IntersectionObserver(handleIntersection, {
      root: nextRoot,
      rootMargin: '100px 0px',
      threshold: 0
    });
    observedBlockElements.forEach(element => observer.observe(element));
    return observer;
  };

  /**
   * 获取或计算面板的实际高度，并缓存结果
   * @param {string} annotationId
   * @returns {Promise<number>} 面板高度
   */
  const getPanelHeight = async (annotationId) => {
    if (panelHeightCache.has(annotationId)) {
      const cachedHeight = panelHeightCache.get(annotationId);
      return cachedHeight;
    }

    const panelEl = panelFinder.findAnnotationPanel(annotationId); // 使用 annotationId 查找
    if (!panelEl) {
        panelHeightCache.set(annotationId, 120); // 缓存默认高度
        return 120; // 默认高度
    }

    await nextTick(); // 确保DOM渲染
    try {
      void panelEl.offsetHeight; // 触发重排以获取准确高度
      const rect = panelFinder.getElementRect(panelEl);
      if (rect && rect.height > 0) {
        const domHeight = rect.height;
        panelHeightCache.set(annotationId, domHeight); // 缓存高度
        return domHeight;
      } else {
        panelHeightCache.set(annotationId, 120); // 缓存默认高度
        return 120;
      }
    } catch (e) {
      console.error(`[OverlapDetector-getPanelHeight] ${annotationId}: Error getting height:`, e);
    }

    panelHeightCache.set(annotationId, 120); // 缓存默认高度
    return 120; // 获取失败返回默认高度
  };

  /**
   * 清理指定批注的高度缓存
   * @param {string} annotationId
   */
  const cleanupAnnotationHeight = (annotationId) => {
    panelHeightCache.delete(annotationId);
  };

  /**
   * 获取块在文档中的位置（通过 blockPosIndex 缓存实现 O(1) 查找）
   * @param {string} blockId 块 ID
   * @returns {number} 块在文档中的位置，如果找不到则返回 Infinity
   */
  const getBlockPositionInDocument = (blockId) => {
    if (!editor || !editor.state) {
      console.warn('[PanelOverlapDetector] getBlockPositionInDocument: editor is missing or invalid.');
      return Infinity;
    }
    const rootBlockId = resolveAnnotationRootBlockId(editor, blockId) || blockId;
    const index = getBlockPosIndex(editor.state.doc);
    const pos = index.get(rootBlockId);
    if (pos !== undefined) return pos;

    console.warn(`[PanelOverlapDetector] getBlockPositionInDocument: Block position not found for ID: ${blockId}`);
    return Infinity;
  };

  /**
   * 处理面板重叠 (负责所有 Top 位置的计算与更新)
   * @returns {Promise<boolean>} - 是否处理了重叠情况
   */
  const handlePanelOverlaps = async () => {
    // 获取当前 annotations
    const annotationsRef = annotationStore?.annotations;
    let currentAnnotations = [];
    if (annotationsRef) {
        const value = typeof annotationsRef.value !== 'undefined' ? annotationsRef.value : annotationsRef;
        if (Array.isArray(value)) {
            currentAnnotations = [...value];
        } else {
             console.warn('[PanelOverlapDetector] annotationStore.annotations is not an array or ref to array.');
        }
    } else {
        console.warn('[PanelOverlapDetector] annotationStore or annotations not available.');
    }

    if (currentAnnotations.length === 0) {
      return false;
    }

    // Sorting logic
    if (editor && editor.state) {
      const blockPositions = {};
      for (const anno of currentAnnotations) {
        if (!blockPositions[anno.blockId]) {
          const rootBlockId = resolveAnnotationRootBlockId(editor, anno.blockId) || anno.blockId;
          blockPositions[anno.blockId] = getBlockPositionInDocument(rootBlockId);
        }
      }

      currentAnnotations.sort((a, b) => {
        const posA = blockPositions[a.blockId] === undefined ? Infinity : blockPositions[a.blockId];
        const posB = blockPositions[b.blockId] === undefined ? Infinity : blockPositions[b.blockId];
        if (posA === Infinity && posB === Infinity) return 0; // Both not found
        if (posA === Infinity) return 1; // a goes after b
        if (posB === Infinity) return -1; // b goes after a
        if (posA === posB) {
            // Fallback to top sort if blocks are the same or positions identical (unlikely for different blocks)
            return (a.position?.top ?? 0) - (b.position?.top ?? 0);
        }
        return posA - posB;
      });
    } else {
      console.warn('[PanelOverlapDetector] Editor not available, sorting based on current top position.');
      currentAnnotations.sort((a, b) => (a.position?.top ?? 0) - (b.position?.top ?? 0));
    }

    // ✅ 修改：即使只有一个面板，也要计算并强制归位到理想 Top
    // 原来是 if (length <= 1) return false;

    let hasAdjustments = false;
    let maxIterations = currentAnnotations.length * 2;
    let iterationCount = 0;
    let adjustmentsMadeThisRound = true;
    const targetPositions = new Map(currentAnnotations.map(a => [a.id, {
      top: a.position?.top ?? 0,
      left: a.position?.left ?? 0,
    }]));

    while (adjustmentsMadeThisRound && iterationCount < maxIterations) {
      adjustmentsMadeThisRound = false;
      iterationCount++;

      for (let i = 0; i < currentAnnotations.length; i++) {
        const currentAnno = currentAnnotations[i];
        const currentId = currentAnno.id;
        const currentPositionFromLastRound = targetPositions.get(currentId);
        const currentTopFromLastRound = currentPositionFromLastRound?.top ?? 0;
        const currentLeftFromLastRound = currentPositionFromLastRound?.left ?? 0;

        const idealPositionCSS = calculateAnnotationPanelIdealPosition({
          blockId: currentAnno.blockId,
          editor,
          panelFinder,
        });
        let idealTop = null;
        let idealLeft = null;
        if (idealPositionCSS && idealPositionCSS.top) {
            const parsedTop = parseFloat(idealPositionCSS.top);
            if (!isNaN(parsedTop)) {
                idealTop = standardizePrecision(parsedTop);
            }
        }
        if (idealPositionCSS && idealPositionCSS.left) {
            const parsedLeft = parseFloat(idealPositionCSS.left);
            if (!isNaN(parsedLeft)) {
                idealLeft = standardizePrecision(parsedLeft);
            }
        }
        if (idealTop === null) {
            idealTop = currentTopFromLastRound; // Fallback
        }
        if (idealLeft === null) {
            idealLeft = currentLeftFromLastRound;
        }

        let minRequiredTop = 0;
        if (i > 0) {
            let maxRequiredTopBasedOnPrev = 0;
            // Check all previous annotations in the *sorted* list
            for (let j = 0; j < i; j++) { 
                const prevAnno = currentAnnotations[j]; 
                const prevId = prevAnno.id;
                const prevTop = targetPositions.get(prevId)?.top ?? 0;
                const prevHeight = await getPanelHeight(prevId);
                const prevBottom = standardizePrecision(prevTop + prevHeight);
                const requiredTopBasedOnThisPrev = standardizePrecision(prevBottom + MIN_PANEL_GAP);
                maxRequiredTopBasedOnPrev = Math.max(maxRequiredTopBasedOnPrev, requiredTopBasedOnThisPrev);
            }
            minRequiredTop = maxRequiredTopBasedOnPrev;
        }

        const targetTopThisRound = Math.max(idealTop, minRequiredTop);
        const roundedTarget = standardizePrecision(targetTopThisRound);
        const roundedCurrent = standardizePrecision(currentTopFromLastRound);
        const roundedLeft = standardizePrecision(idealLeft);
        const roundedCurrentLeft = standardizePrecision(currentLeftFromLastRound);

        if (roundedTarget !== roundedCurrent || roundedLeft !== roundedCurrentLeft) {
             targetPositions.set(currentId, {
               top: roundedTarget,
               left: roundedLeft,
             });
             adjustmentsMadeThisRound = true;
             hasAdjustments = true;
        } else {
             targetPositions.set(currentId, {
               top: roundedTarget,
               left: roundedLeft,
             }); // Ensure map has precise value
        }
      }
    }

    // 应用最终调整到 store
    if (hasAdjustments) {
      const updatePromises = [];
      targetPositions.forEach((finalPosition, annotationId) => {
        const originalAnnotation = annotationStore.getAnnotationById(annotationId);
        // 仅当计算出的 finalPosition 与 store 中不同时才更新
        // 使用 standardizePrecision 比较避免浮点数精度问题
        if (
          originalAnnotation &&
          (
            standardizePrecision(originalAnnotation.position.top) !== standardizePrecision(finalPosition.top) ||
            standardizePrecision(originalAnnotation.position.left) !== standardizePrecision(finalPosition.left)
          )
        ) {
          // 中文说明：top 由重叠避让决定；left 是从 rootBlock / 批注入口布局派生的视觉锚点。
          // 不继续信任旧 store left，避免历史错误位置或 Host 迁移期间的瞬时位置污染界面。
          updatePromises.push(
            annotationStore.updateAnnotation(annotationId, {
              position: finalPosition
            })
          );
        }
      });
      // 如果有需要更新的 promise
      if (updatePromises.length > 0) {
         await Promise.all(updatePromises); // 并行更新 store
      }
    }

    return hasAdjustments;
  };

  /**
   * 重新计算所有面板位置
   * @param {boolean} resetToIdeal - 是否重置到理想位置
   */
  const recalculateAllPanelPositions = async (resetToIdeal = true) => {
    const annotationsRef = annotationStore?.annotations;
    let currentAnnotations = [];
    if (annotationsRef) {
        const value = typeof annotationsRef.value !== 'undefined' ? annotationsRef.value : annotationsRef;
        if (Array.isArray(value)) {
            currentAnnotations = [...value];
        } else {
             console.warn('[PanelOverlapDetector] recalculateAllPanelPositions: annotations not an array.');
        }
    } else {
        console.warn('[PanelOverlapDetector] recalculateAllPanelPositions: annotationStore not available.');
    }

    if (currentAnnotations.length === 0) {
      return;
    }
    
    // --- 优化：根据场景选择要处理的批注 ---
    const annotationsToProcess = !resetToIdeal
      ? currentAnnotations.filter(anno => visibleBlockIds.has(anno.blockId))
      : currentAnnotations;

    // ✅ 修改：只更新 Left 值 (Top 值全权交给 handlePanelOverlaps)
    // 之前这里也更新 Top，会导致和 handlePanelOverlaps 冲突（先重置再避让，导致跳动）
    const updatePromises = [];
    for (const annotation of annotationsToProcess) {
      if (resetToIdeal && (annotation.state === 'editing' || annotation.state === 'creating')) {
        continue;
      }
      
      const idealPositionCSS = calculateAnnotationPanelIdealPosition({
        blockId: annotation.blockId,
        editor,
        panelFinder,
      });
      if (idealPositionCSS) {
        // 在重置模式下，更新 left 值
        const idealLeft = resetToIdeal ? standardizePrecision(parseFloat(idealPositionCSS.left)) : annotation.position.left;
        
        // 仅当 Left 变化时才更新
        if (resetToIdeal && standardizePrecision(annotation.position.left) !== idealLeft) {
          updatePromises.push(
            annotationStore.updateAnnotation(annotation.id, {
              position: { top: annotation.position.top, left: idealLeft } // Top 保持不变
            })
          );
          cleanupAnnotationHeight(annotation.id);
        }
      }
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      await nextTick();
    }

    // ✅ 修改：无条件调用 handlePanelOverlaps
    // 现在 handlePanelOverlaps 负责所有面板（包括单个面板）的 Top 定位
    await handlePanelOverlaps();
  };

  // 清理与特定批注相关的内部状态 (主要是高度缓存)
  const invalidateCacheForAnnotation = (annotationId) => {
    cleanupAnnotationHeight(annotationId);
  }

  // 整体清理 (如果需要)
  const cleanup = () => {
    panelHeightCache.clear();
    visibleBlockIds.clear();
    observedBlockElements.clear();
    observer?.disconnect();
    observer = null;
    observerRoot = null;
  }

  return {
    handlePanelOverlaps,
    recalculateAllPanelPositions,
    invalidateCacheForAnnotation, // 暴露给 Calculator/Manager
    cleanup, // 暴露给 Calculator/Manager
    // +++ 新增：暴露 observer 的接口 +++
    observeBlock: (element) => {
      if (element instanceof Element) {
        const editorRoot = panelFinder.findEditorRoot();
        if (!editorRoot?.contains(element)) return;
        observedBlockElements.add(element);
        ensureObserver()?.observe(element);
      }
    },
    unobserveBlock: (element) => {
      if (element instanceof Element) {
        observedBlockElements.delete(element);
        observer?.unobserve(element);
        const blockId = element.dataset.id;
        if (blockId) visibleBlockIds.delete(blockId);
      }
    }
  };
}
