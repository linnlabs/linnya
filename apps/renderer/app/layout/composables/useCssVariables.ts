/**
 * CSS 变量管理 composable
 * 
 * 职责：
 * - 同步 uiStore 状态到 CSS 变量
 * - 管理侧边栏宽度相关的 CSS 变量
 * - 计算侧边栏偏移量用于批注面板定位
 */

import { watchEffect, computed } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { useSidebarLayoutWidth } from './useSidebarLayoutWidth';

/**
 * CSS 变量管理 composable
 * 
 * 自动监听 uiStore 状态变化并同步到 CSS 变量
 */
export function useCssVariables() {
  const uiStore = useUIStore();
  const { sidebarWidth, sidebarOccupiedWidth } = useSidebarLayoutWidth();

  /**
   * 同步侧边栏宽度到 CSS 变量
   */
  watchEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth.value}px`);
    document.documentElement.style.setProperty('--sidebar-occupied-width', `${sidebarOccupiedWidth.value}px`);
  });

  /**
   * 实时维护侧边栏偏移量 CSS 变量
   * 用于批注面板丝滑跟随
   */
  watchEffect(() => {
    // 计算相对于"无侧边栏状态"的横向偏移量
    const leftOffset = sidebarOccupiedWidth.value;
    const deltaX = leftOffset;
    
    document.documentElement.style.setProperty('--sidebar-deltaX', `${deltaX}px`);
  });

  /**
   * 计算内容区域样式
   * 返回响应式的 margin 样式对象
   */
  const contentAreaStyle = computed(() => {
    const leftMargin = `${sidebarOccupiedWidth.value}px`;
    return {
      marginLeft: leftMargin,
      marginRight: '0px',
    };
  });

  return {
    contentAreaStyle,
  };
}
