import { onBeforeUnmount, shallowRef, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { readRootBlockIdFromChromeEventTarget } from '../functions/readRootBlockIdFromChromeEventTarget';

/**
 * rootBlock hover 对应的 active chrome 来源。
 *
 * 中文说明：这里使用 editor 根 DOM 的 pointerover / pointerout 事件委托，
 * 只在鼠标跨 rootBlock 边界时更新状态，避免 pointermove 热路径重新拖慢滚动。
 */
export function useRootBlockHoverChromeSource(editor: Editor): Ref<string | null> {
  const hoveredBlockId = shallowRef<string | null>(null);
  const editorRoot = editor.view.dom;

  function handlePointerOver(event: PointerEvent): void {
    const nextBlockId = readRootBlockIdFromChromeEventTarget(event.target);
    if (nextBlockId === hoveredBlockId.value) return;
    hoveredBlockId.value = nextBlockId;
  }

  function handlePointerOut(event: PointerEvent): void {
    const currentBlockId = readRootBlockIdFromChromeEventTarget(event.target);
    if (!currentBlockId || currentBlockId !== hoveredBlockId.value) return;

    const relatedBlockId = readRootBlockIdFromChromeEventTarget(event.relatedTarget);
    if (relatedBlockId === currentBlockId) return;

    hoveredBlockId.value = null;
  }

  editorRoot.addEventListener('pointerover', handlePointerOver);
  editorRoot.addEventListener('pointerout', handlePointerOut);

  onBeforeUnmount(() => {
    editorRoot.removeEventListener('pointerover', handlePointerOver);
    editorRoot.removeEventListener('pointerout', handlePointerOut);
  });

  return hoveredBlockId;
}
