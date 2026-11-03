import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasEdge, CanvasEdgeId } from '@plugin/canvas/shared';
import type { CanvasConnectionPreview } from '../definitions/canvasConnections';
export function createCanvasConnectionState() {
  const selectedId = shallowRef<CanvasEdgeId | null>(null), label = shallowRef<{ readonly edge: CanvasEdge; readonly value: string } | null>(null);
  const preview = shallowRef<CanvasConnectionPreview | null>(null);
  return { selectedId: shallowReadonly(selectedId), label: shallowReadonly(label), preview: shallowReadonly(preview),
    select(id: CanvasEdgeId | null) { selectedId.value = id; },
    beginLabel(edge: CanvasEdge) { label.value = { edge, value: edge.label }; },
    updateLabel(value: string) { if (label.value) label.value = { ...label.value, value }; },
    endLabel() { label.value = null; },
    setPreview(value: CanvasConnectionPreview | null) { preview.value = value; },
  };
}
