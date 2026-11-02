/**
 * 内容区样式 composable
 *
 * 只把侧边栏占位写到内容区自身。不要把拖拽中的宽度同步到 :root 的 CSS 变量：
 * 自定义属性会继承，每帧都会让整棵 DOM 重算样式，项目越多拖动越卡。
 */

import { computed } from 'vue';
import { useSidebarLayoutWidth } from './useSidebarLayoutWidth';

export function useContentAreaStyle() {
  const { sidebarOccupiedWidth } = useSidebarLayoutWidth();

  const contentAreaStyle = computed(() => ({
    marginLeft: `${sidebarOccupiedWidth.value}px`,
    marginRight: '0px',
  }));

  return {
    contentAreaStyle,
  };
}
