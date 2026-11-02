/**
 * 侧边栏动画事件管理 composable
 * 
 * 职责：
 * - 监听侧边栏可见性和宽度变化
 * - 发送动画开始/结束事件
 */

import { nextTick, onUnmounted, watch } from 'vue';
import { useUIStore } from '@/shared/stores/ui';

/** 侧边栏动画开始事件详情 */
interface SidebarAnimStartDetail {
  reason: 'sidebar-visible' | 'sidebar-width';
}

/** 侧边栏动画结束事件详情 */
interface SidebarAnimEndDetail {
  propertyName: string;
}

/**
 * 侧边栏动画事件 composable
 * 
 * 自动监听侧边栏状态变化并发送相应事件
 */
export function useSidebarAnimationEvents() {
  const uiStore = useUIStore();
  let transitionActive = false;
  let scheduledEndRevision = 0;

  const dispatchSidebarAnimEnd = () => {
    if (!transitionActive) return;
    transitionActive = false;
    window.dispatchEvent(
      new CustomEvent<SidebarAnimEndDetail>('sidebar-anim-end', {
        detail: { propertyName: 'margin-left' },
      }),
    );
  };

  /**
   * 发送侧边栏动画开始事件
   */
  const dispatchSidebarAnimStart = (reason: SidebarAnimStartDetail['reason']) => {
    // 一次连续拖动只有一轮布局事务；逐帧结束会让 Editor 反复执行最终测量。
    if (transitionActive) return;
    transitionActive = true;
    window.dispatchEvent(
      new CustomEvent<SidebarAnimStartDetail>('sidebar-anim-start', { 
        detail: { reason } 
      })
    );
  };

  /**
   * 处理侧边栏过渡结束事件
   * 用于监听 content-area 的 margin 过渡结束
   */
  const emitSidebarTransitionEnd = (event: TransitionEvent) => {
    if (event.propertyName === 'margin-left') {
      scheduledEndRevision += 1;
      dispatchSidebarAnimEnd();
    }
  };

  watch(
    [() => uiStore.sidebarVisible, () => uiStore.sidebarWidth, () => uiStore.sidebarResizing],
    ([visible, width, resizing], [previousVisible, previousWidth, wasResizing]) => {
      if (resizing) {
        if (!wasResizing) dispatchSidebarAnimStart('sidebar-width');
        return;
      }
      if (wasResizing) {
        const revision = ++scheduledEndRevision;
        // 最终宽度和拖动态同批提交；等 DOM 更新后结束，不能在最后一帧重新开启事务。
        void nextTick(() => {
          if (revision === scheduledEndRevision) dispatchSidebarAnimEnd();
        });
        return;
      }
      if (visible !== previousVisible) dispatchSidebarAnimStart('sidebar-visible');
      else if (width !== previousWidth) dispatchSidebarAnimStart('sidebar-width');
    },
  );

  onUnmounted(() => {
    scheduledEndRevision += 1;
    transitionActive = false;
  });

  return {
    dispatchSidebarAnimStart,
    emitSidebarTransitionEnd,
  };
}
