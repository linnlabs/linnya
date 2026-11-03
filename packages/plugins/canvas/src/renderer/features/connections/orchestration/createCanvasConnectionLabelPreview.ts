import { computed } from 'vue';
import type { CanvasEdge, CanvasEdgeId } from '@plugin/canvas/shared';
import { createCanvasLabelPreviewState } from '../store/createCanvasLabelPreviewState';

/** Canvas命中与DOM面板之间留120ms越过间隙；只保留身份，全文始终读取最新正式连线。 */
export function createCanvasConnectionLabelPreview(read: (id: CanvasEdgeId) => CanvasEdge | null) {
  const state = createCanvasLabelPreviewState(); let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  const dismiss = () => { cancel(); state.clear(); };
  const leave = () => { cancel(); timer = setTimeout(() => { timer = null; if (!state.inside.value) state.clear(); }, 120); };
  window.addEventListener('blur', dismiss);
  return { content: computed(() => { const edge = state.id.value ? read(state.id.value) : null; return edge?.label.trim() ? edge : null; }),
    hover(id: CanvasEdgeId | null) { if (id) { cancel(); state.show(id); } else leave(); },
    enter() { cancel(); state.enter(); }, leave() { state.leave(); leave(); }, dismiss,
    dispose() { dismiss(); window.removeEventListener('blur', dismiss); },
  };
}
