import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasHistoryPreviewState } from '../definitions/canvasHistoryPreview';
export function createCanvasHistoryPreviewState(): CanvasHistoryPreviewState {
  const phase = shallowRef<'loading' | 'ready' | 'failed'>('loading'), error = shallowRef<string | null>(null);
  return { phase: shallowReadonly(phase), error: shallowReadonly(error), loading() { phase.value = 'loading'; error.value = null; }, ready() { phase.value = 'ready'; }, fail(message) { phase.value = 'failed'; error.value = message; } };
}
