import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasEdge, CanvasEdgeId } from '@plugin/canvas/shared';
import type { CanvasConnectionPreview } from '../definitions/canvasConnections';
export function createCanvasConnectionState() {
  const selectedId = shallowRef<CanvasEdgeId | null>(null), label = shallowRef<{ readonly edge: CanvasEdge; readonly value: string; readonly identity: string; readonly editSequence: number } | null>(null);
  const preview = shallowRef<CanvasConnectionPreview | null>(null);
  return { selectedId: shallowReadonly(selectedId), label: shallowReadonly(label), preview: shallowReadonly(preview),
    select(id: CanvasEdgeId | null) { selectedId.value = id; },
    beginLabel(edge: CanvasEdge) { label.value = { edge, value: edge.label, identity: crypto.randomUUID(), editSequence: 0 }; },
    updateLabel(value: string) { if (label.value) label.value = { ...label.value, value, editSequence: label.value.editSequence + 1 }; },
    endLabel() { label.value = null; },
    setPreview(value: CanvasConnectionPreview | null) { preview.value = value; },
  };
}
