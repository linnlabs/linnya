import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useLayoutStore } from '../store/layoutStore';
import { computeWorkspacePaneGeometryFromLayoutState } from '../functions/workspacePaneGeometry';
import { useSidebarLayoutWidth } from './useSidebarLayoutWidth';

function readViewportWidth(): number {
  return typeof globalThis.innerWidth === 'number' ? globalThis.innerWidth : 0;
}

/**
 * 把窗口和左侧栏的实时尺寸接到纯几何函数上。
 * Header 与 WorkspaceStage 必须共同消费这里的结果，避免标题栏和内容分割线各算一套。
 */
export function useWorkspacePaneGeometry() {
  const layoutStore = useLayoutStore();
  const { sidebarOccupiedWidth } = useSidebarLayoutWidth();
  const viewportWidth = ref(readViewportWidth());

  const updateViewportWidth = () => {
    viewportWidth.value = readViewportWidth();
  };

  onMounted(() => {
    updateViewportWidth();
    globalThis.addEventListener?.('resize', updateViewportWidth);
  });

  onBeforeUnmount(() => {
    globalThis.removeEventListener?.('resize', updateViewportWidth);
  });

  const hasWorkspaceFileSurface = computed(() => (
    layoutStore.state.activeDocument !== null
    || layoutStore.state.documentPane.emptyStateVisible
  ));

  const geometry = computed(() => {
    const measuredStageWidth = layoutStore.workspaceStageWidth;
    const availableWidth = measuredStageWidth > 0
      ? measuredStageWidth
      : Math.max(0, viewportWidth.value - sidebarOccupiedWidth.value);
    return computeWorkspacePaneGeometryFromLayoutState(layoutStore.state, availableWidth);
  });

  return {
    geometry,
    hasWorkspaceFileSurface,
  };
}
