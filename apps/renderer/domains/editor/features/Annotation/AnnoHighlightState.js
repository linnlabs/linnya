// src/renderer/extensions/annotation/AnnoHighlightState.js
/**
 * AnnoHighlightState.js
 * 
 * 批注双向高亮状态管理，处理块与批注面板的联动高亮效果
 */

import { ref, reactive } from 'vue';

// 跟踪当前高亮的块ID和批注面板ID
const highlightedBlockId = ref(null);
const highlightedPanelId = ref(null);

// 创建批注高亮状态管理工具
export function createAnnotationHighlightState() {
  /**
   * 高亮块和对应的批注面板
   * 
   * @param {string} blockId - 要高亮的块ID
   */
  const highlightBlock = (blockId) => {
    if (!blockId) return;
    
    // 如果当前没有批注面板（包括新建面板），则不执行高亮
    const panels = document.querySelectorAll(`.annotation-panel[data-block-id="${blockId}"]`);
    if (panels.length === 0) return;

    // 记录当前高亮的块ID
    highlightedBlockId.value = blockId;
        
    // 高亮对应的批注面板
    panels.forEach(panel => {
      panel.classList.add('annotation-highlight-panel');
      
      // 记录批注面板ID（只针对已确认的批注面板，新建面板没有annotation-id）
      if (panel.dataset.annotationId && panel.dataset.isNew !== 'true') {
        highlightedPanelId.value = panel.dataset.annotationId;
      }
    });
  };
  
  /**
   * 清除块的高亮状态
   * 
   * @param {string} blockId - 要清除高亮的块ID
   */
  const clearBlockHighlight = (blockId) => {
    if (!blockId) return;
    
    // 如果传入的blockId与当前高亮的不一致，说明可能是因为移入了另一个元素，不清除高亮
    if (blockId !== highlightedBlockId.value) return;
        
    // 清除对应批注面板的高亮
    const panels = document.querySelectorAll(`.annotation-panel[data-block-id="${blockId}"]`);
    panels.forEach(panel => {
      panel.classList.remove('annotation-highlight-panel');
    });
    
    // 重置状态
    highlightedBlockId.value = null;
    highlightedPanelId.value = null;
  };
  
  /**
   * 高亮批注面板和对应的块
   * 
   * @param {string} annotationId - 批注ID
   * @param {string} blockId - 关联的块ID
   */
  const highlightPanel = (annotationId, blockId) => {
    if (!annotationId && !blockId) return;

    // 如果传入了blockId，使用blockId查找面板
    if (blockId) {
      // 记录当前高亮的批注ID
      highlightedBlockId.value = blockId;
      
      // 高亮对应的块
      const blockElement = document.querySelector(`.root-block-outer[data-id="${blockId}"]`);
      if (blockElement) {
        blockElement.classList.add('annotation-highlight-block');
      }
      
      // 高亮批注面板
      const panels = document.querySelectorAll(`.annotation-panel[data-block-id="${blockId}"]`);
      panels.forEach(panel => {
        panel.classList.add('annotation-highlight-panel');
        
        // 记录批注面板ID，只处理非新建面板
        if (panel.dataset.annotationId && annotationId) {
          highlightedPanelId.value = panel.dataset.annotationId;
        }
      });
      
      return;
    }
    
    // 如果只传入了annotationId，使用annotationId查找面板
    if (annotationId) {
      // 记录当前高亮的批注ID
      highlightedPanelId.value = annotationId;
      
      // 查找并高亮面板
      const panel = document.querySelector(`.annotation-panel[data-annotation-id="${annotationId}"]`);
      if (panel) {
        panel.classList.add('annotation-highlight-panel');
        
        // 获取面板关联的块ID
        const relatedBlockId = panel.dataset.blockId;
        if (relatedBlockId) {
          // 记录块ID
          highlightedBlockId.value = relatedBlockId;
          
          // 高亮对应的块
          const blockElement = document.querySelector(`.root-block-outer[data-id="${relatedBlockId}"]`);
          if (blockElement) {
            blockElement.classList.add('annotation-highlight-block');
          }
        }
      }
    }
  };
  
  /**
   * 清除批注面板的高亮状态
   * 
   * @param {string} annotationId - 批注ID
   * @param {string} blockId - 关联的块ID
   */
  const clearPanelHighlight = (annotationId, blockId) => {
    // 检查两个ID是否都无效，或者当前没有高亮，直接返回
    if ((!annotationId && !blockId) || (!highlightedBlockId.value && !highlightedPanelId.value)) {
      return;
    }

    // 根据传入的 annotationId 和 blockId 确定要清除高亮的块 ID
    // 优先使用 blockId，如果 blockId 不存在，则通过 annotationId 查询面板获取
    const blockIdToClear = blockId || 
      (annotationId ? document.querySelector(`.annotation-panel[data-annotation-id="${annotationId}"]`)?.dataset.blockId : null);

    // 根据传入的 annotationId 确定要清除高亮的面板 ID
    const panelIdToClear = annotationId || highlightedPanelId.value;

    // 如果当前高亮的 ID 与要清除的 ID 不匹配，则不执行任何操作
    // 这可以防止鼠标快速移入另一个元素时错误地清除了高亮
    if (blockIdToClear !== highlightedBlockId.value && panelIdToClear !== highlightedPanelId.value) {
      return;
    }

    // 清除块的高亮
    if (blockIdToClear) {
      const blockElement = document.querySelector(`.root-block-outer[data-id="${blockIdToClear}"]`);
      if (blockElement) {
        blockElement.classList.remove('annotation-highlight-block');
      }
    }

    // 清除面板的高亮
    if (panelIdToClear) {
      const panel = document.querySelector(`.annotation-panel[data-annotation-id="${panelIdToClear}"]`);
      if (panel) {
        panel.classList.remove('annotation-highlight-panel');
      }
    }
    
    // 如果是按 blockId 清除，则清除所有关联面板的高亮
    if (blockIdToClear) {
        const panels = document.querySelectorAll(`.annotation-panel[data-block-id="${blockIdToClear}"]`);
        panels.forEach(p => p.classList.remove('annotation-highlight-panel'));
    }

    // 重置状态
    highlightedBlockId.value = null;
    highlightedPanelId.value = null;
  };
  
  /**
   * 获取当前高亮状态
   */
  const getHighlightState = () => {
    return {
      blockId: highlightedBlockId.value,
      panelId: highlightedPanelId.value
    };
  };

  // 返回高亮状态和方法
  return {
    highlightedBlockId,
    highlightedPanelId,
    highlightBlock,
    clearBlockHighlight,
    highlightPanel,
    clearPanelHighlight,
    getHighlightState
  };
}

// 创建一个单例实例，方便在不同组件中共享
const highlightState = createAnnotationHighlightState();

export default highlightState;