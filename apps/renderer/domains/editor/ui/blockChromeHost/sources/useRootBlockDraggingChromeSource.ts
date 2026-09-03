import { onBeforeUnmount, shallowRef, type Ref } from 'vue';
import {
  getRootBlockDragStateSnapshot,
  subscribeRootBlockDragState,
} from '../../../extensions/interaction/drag/rootBlockDragState';

/**
 * rootBlock 拖拽中的 active chrome 来源。
 *
 * 中文说明：Host 只订阅拖拽 feature 暴露的窄运行态，不反查 body dataset /
 * sessionStorage。这样后续拖拽实现换掉时，BlockChromeHost 不需要跟着改。
 */
export function useRootBlockDraggingChromeSource(): Ref<string | null> {
  const draggingBlockId = shallowRef(getRootBlockDragStateSnapshot().draggingRootBlockId);
  const unsubscribe = subscribeRootBlockDragState((snapshot) => {
    draggingBlockId.value = snapshot.draggingRootBlockId;
  });

  onBeforeUnmount(() => {
    unsubscribe();
  });

  return draggingBlockId;
}
