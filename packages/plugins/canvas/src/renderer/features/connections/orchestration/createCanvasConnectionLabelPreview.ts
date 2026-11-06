import { computed } from 'vue';
import type { CanvasEdge, CanvasEdgeId } from '@plugin/canvas/shared';
import { CANVAS_LINE_LABEL_FONT, canvasLineLabelTruncated } from '../../../kernel/text';
import { createCanvasLabelPreviewState } from '../store/createCanvasLabelPreviewState';

let measureContext: CanvasRenderingContext2D | null = null;
function measureLineLabel(text: string): number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) throw new Error('canvas_2d_unavailable');
  measureContext.font = CANVAS_LINE_LABEL_FONT;
  return measureContext.measureText(text).width;
}

/**
 * Canvas命中与DOM面板之间留120ms越过间隙；只保留身份，全文始终读取最新正式连线。
 * 画布上已完整显示的标签不再弹全文，只有被截断或含换行的标签才需要悬停看全文。
 */
export function createCanvasConnectionLabelPreview(
  read: (id: CanvasEdgeId) => CanvasEdge | null,
  measure: (text: string) => number = measureLineLabel
) {
  const state = createCanvasLabelPreviewState();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const dismiss = () => {
    cancel();
    state.clear();
  };
  const leave = () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (!state.inside.value) state.clear();
    }, 120);
  };
  window.addEventListener('blur', dismiss);
  return {
    content: computed(() => {
      const edge = state.id.value ? read(state.id.value) : null;
      return edge?.label.trim() && canvasLineLabelTruncated(edge.label, measure) ? edge : null;
    }),
    hover(id: CanvasEdgeId | null) {
      if (id) {
        cancel();
        state.show(id);
      } else leave();
    },
    enter() {
      cancel();
      state.enter();
    },
    leave() {
      state.leave();
      leave();
    },
    dismiss,
    dispose() {
      dismiss();
      window.removeEventListener('blur', dismiss);
    },
  };
}
