/**
 * 时间轴滚动同步逻辑
 * 功能 (What): 管理主滚动容器和时间轴之间的同步
 */

import { ref, type Ref } from 'vue';
import type { ConversationVisualTurnId } from '@app/schemas';

export interface ScrollSyncOptions {
  scrollContainer: Ref<HTMLElement | null>;
  onActiveChange?: (visualTurnId: ConversationVisualTurnId) => void;
}

/**
 * 使用时间轴滚动同步
 */
export function useTimelineSync(options: ScrollSyncOptions) {
  const { scrollContainer, onActiveChange } = options;
  
  // 当前激活的轮次ID
  const activeVisualTurnId = ref<ConversationVisualTurnId | null>(null);
  
  // 滚动同步的RAF ID
  let scrollRafId: number | null = null;
  
  // 防抖：避免频繁切换激活状态
  let activeChangeTimer: number | null = null;
  let pendingActiveId: ConversationVisualTurnId | null = null;
  let lastActiveChangeTime = 0;
  const MIN_ACTIVE_CHANGE_INTERVAL = 120; // ms

  /**
   * 根据滚动位置计算当前激活的轮次
   * 改进逻辑：激活视口内最上面的轮次（已经滚动过的），而不是最接近某个参考点的
   */
  function computeActiveByScroll(visualTurnPositions: Map<ConversationVisualTurnId, number>) {
    const container = scrollContainer.value;
    if (!container || visualTurnPositions.size === 0) return;

    const scrollTop = container.scrollTop;
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + container.clientHeight;
    const scrollHeight = container.scrollHeight;
    
    // 优先规则：在页面顶部时，优先激活第一条（避免相邻两条过近导致首条永远无法激活）
    let firstVisualTurnId: ConversationVisualTurnId | null = null;
    let firstTurnTop = Infinity;
    visualTurnPositions.forEach((top, id) => {
      if (top < firstTurnTop) {
        firstTurnTop = top;
        firstVisualTurnId = id;
      }
    });
    if (firstVisualTurnId && viewportTop <= firstTurnTop + 2) {
      if (firstVisualTurnId !== activeVisualTurnId.value) {
        const now = performance.now();
        const timeSinceLastChange = now - lastActiveChangeTime;
        if (timeSinceLastChange >= MIN_ACTIVE_CHANGE_INTERVAL) {
          activeVisualTurnId.value = firstVisualTurnId;
          onActiveChange?.(firstVisualTurnId);
          lastActiveChangeTime = now;
        } else {
          pendingActiveId = firstVisualTurnId;
        }
      }
      return;
    }
    
    // 🔥 优先检查：如果已接近底部，强制激活最后一条
    const nearBottomTolerance = 50;
    const isNearBottom = viewportBottom >= scrollHeight - nearBottomTolerance;
    
    let activeId: ConversationVisualTurnId | null = null;
    
    if (isNearBottom) {
      // 在底部时，直接激活最后一条
      let lastId: ConversationVisualTurnId | null = null;
      let maxTop = -Infinity;
      visualTurnPositions.forEach((top, id) => {
        if (top > maxTop) {
          maxTop = top;
          lastId = id;
        }
      });
      activeId = lastId;
    } else {
      // 不在底部时，使用正常逻辑
      // 策略：找到刚好在视口顶部之下（或稍微上面一点）的第一个轮次
      const threshold = viewportTop + 100; // 容忍度：顶部以下 100px 内
      
      let bestTop = -Infinity;

      visualTurnPositions.forEach((top, visualTurnId) => {
        // 只考虑在视口中的轮次，或者刚好在视口上方一点的轮次
        if (top <= threshold && top > bestTop) {
          bestTop = top;
          activeId = visualTurnId;
        }
      });
      
      // 如果没有找到（都在下面），选择第一个可见的
      if (!activeId) {
        let firstVisibleTop = Infinity;
        visualTurnPositions.forEach((top, visualTurnId) => {
          if (top >= viewportTop && top < viewportBottom && top < firstVisibleTop) {
            firstVisibleTop = top;
            activeId = visualTurnId;
          }
        });
      }
    }

    if (activeId && activeId !== activeVisualTurnId.value) {
      const now = performance.now();
      const timeSinceLastChange = now - lastActiveChangeTime;

      if (timeSinceLastChange < MIN_ACTIVE_CHANGE_INTERVAL) {
        // 快速滚动时合并变更
        pendingActiveId = activeId;
        if (!activeChangeTimer) {
          const delay = Math.max(MIN_ACTIVE_CHANGE_INTERVAL - timeSinceLastChange, 0);
          activeChangeTimer = window.setTimeout(() => {
            activeChangeTimer = null;
            if (pendingActiveId && pendingActiveId !== activeVisualTurnId.value) {
              activeVisualTurnId.value = pendingActiveId;
              onActiveChange?.(pendingActiveId);
              lastActiveChangeTime = performance.now();
            }
            pendingActiveId = null;
          }, delay);
        }
      } else {
        // 正常更新
        activeVisualTurnId.value = activeId;
        onActiveChange?.(activeId);
        lastActiveChangeTime = now;
      }
    }
  }

  /**
   * 调度滚动同步（使用 RAF）
   */
  function scheduleScrollSync(visualTurnPositions: Map<ConversationVisualTurnId, number>) {
    if (scrollRafId !== null) return;
    
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      computeActiveByScroll(visualTurnPositions);
    });
  }

  function setActiveVisualTurn(visualTurnId: ConversationVisualTurnId | null) {
    activeVisualTurnId.value = visualTurnId;
    if (visualTurnId) {
      onActiveChange?.(visualTurnId);
      lastActiveChangeTime = performance.now();
      pendingActiveId = null;
      if (activeChangeTimer !== null) {
        clearTimeout(activeChangeTimer);
        activeChangeTimer = null;
      }
    }
  }

  /**
   * 清理资源
   */
  function cleanup() {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    if (activeChangeTimer !== null) {
      clearTimeout(activeChangeTimer);
      activeChangeTimer = null;
    }
  }

  return {
    activeVisualTurnId,
    scheduleScrollSync,
    setActiveVisualTurn,
    cleanup,
  };
}
