import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue';
import { useLayoutStore } from '../store/layoutStore';

/**
 * 实测 WorkspaceStage 宽度，覆盖侧栏过渡动画和窗口缩放期间的每一帧。
 * Header 不能自行推算内容区宽度，否则会与正在动画中的真实分割线错位。
 */
export function useWorkspaceStageMeasurement(stageRef: Ref<HTMLElement | null>): void {
  const layoutStore = useLayoutStore();
  let observer: ResizeObserver | null = null;

  const updateWidth = () => {
    layoutStore.setWorkspaceStageWidth(stageRef.value?.getBoundingClientRect().width ?? 0);
  };

  onMounted(async () => {
    await nextTick();
    updateWidth();
    observer = new ResizeObserver(updateWidth);
    if (stageRef.value) observer.observe(stageRef.value);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    layoutStore.setWorkspaceStageWidth(0);
  });
}
