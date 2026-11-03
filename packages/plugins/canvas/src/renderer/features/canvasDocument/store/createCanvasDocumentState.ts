import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasSnapshot } from '@plugin/canvas/shared';
import type { CanvasDocumentPhase, CanvasDocumentState } from '../definitions/canvasDocumentSession';

export function createCanvasDocumentState(): CanvasDocumentState {
  const snapshot = shallowRef<CanvasSnapshot | null>(null);
  const phase = shallowRef<CanvasDocumentPhase>('closed');
  const error = shallowRef<string | null>(null);
  return {
    snapshot: shallowReadonly(snapshot), phase: shallowReadonly(phase), error: shallowReadonly(error),
    begin() { snapshot.value = null; phase.value = 'loading'; error.value = null; },
    install(value) { snapshot.value = value; phase.value = 'ready'; error.value = null; },
    fail(value) { error.value = value; phase.value = 'failed'; },
    clear() { snapshot.value = null; phase.value = 'closed'; error.value = null; },
  };
}
