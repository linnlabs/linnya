import { computed, shallowReadonly, shallowRef } from 'vue';
import type { CanvasDocumentPhase, CanvasDocumentProjection, CanvasDocumentState } from '../definitions/canvasDocumentSession';

export function createCanvasDocumentState(): CanvasDocumentState {
  const projection = shallowRef<CanvasDocumentProjection | null>(null);
  const snapshot = computed(() => projection.value?.snapshot ?? null);
  const phase = shallowRef<CanvasDocumentPhase>('closed');
  const error = shallowRef<string | null>(null);
  return {
    projection: shallowReadonly(projection), snapshot, phase: shallowReadonly(phase), error: shallowReadonly(error),
    begin() { projection.value = null; phase.value = 'loading'; error.value = null; },
    install(value, cardChanges = []) { projection.value = { snapshot: value, cardChanges }; phase.value = 'ready'; error.value = null; },
    fail(value) { error.value = value; phase.value = 'failed'; },
    clear() { projection.value = null; phase.value = 'closed'; error.value = null; },
  };
}
