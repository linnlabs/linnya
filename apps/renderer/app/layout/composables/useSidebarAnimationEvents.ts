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

  const schedulePanelResizeEnd = () => {
    if (!transitionActive) return;
    if (!document.body.classList.contains('panel-resizing')) return;
    const revision = ++scheduledEndRevision;
    // 等 Vue 把最终 margin 提交给 DOM，再通知依赖布局事件的 owner 做一次最终测量。
    void nextTick(() => {
      if (revision !== scheduledEndRevision) return;
      dispatchSidebarAnimEnd();
    });
  };

  /**
   * 发送侧边栏动画开始事件
   */
  const dispatchSidebarAnimStart = (reason: SidebarAnimStartDetail['reason']) => {
    transitionActive = true;
    window.dispatchEvent(
      new CustomEvent<SidebarAnimStartDetail>('sidebar-anim-start', { 
        detail: { reason } 
      })
    );
    schedulePanelResizeEnd();
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

  // 监听侧边栏状态变化，发送动画开始事件
  watch(() => uiStore.sidebarVisible, () => dispatchSidebarAnimStart('sidebar-visible'));
  watch(() => uiStore.sidebarWidth, () => dispatchSidebarAnimStart('sidebar-width'));

  onUnmounted(() => {
    scheduledEndRevision += 1;
    transitionActive = false;
  });

  return {
    dispatchSidebarAnimStart,
    emitSidebarTransitionEnd,
  };
}
