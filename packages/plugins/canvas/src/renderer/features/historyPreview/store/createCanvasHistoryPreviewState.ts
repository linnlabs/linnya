import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasHistoryPreviewState } from '../definitions/canvasHistoryPreview';
import type { CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
export function createCanvasHistoryPreviewState(): CanvasHistoryPreviewState {
  const phase = shallowRef<'loading' | 'ready' | 'failed'>('loading'),
    error = shallowRef<string | null>(null);
  const budget = shallowRef<CanvasVersionBudgetStatus | null>(null),
    renderNotice = shallowRef<string | null>(null);
  return {
    phase: shallowReadonly(phase),
    error: shallowReadonly(error),
    budget: shallowReadonly(budget),
    renderNotice: shallowReadonly(renderNotice),
    loading() {
      phase.value = 'loading';
      error.value = null;
      budget.value = null;
      renderNotice.value = null;
    },
    ready() {
      phase.value = 'ready';
    },
    fail(message) {
      phase.value = 'failed';
      error.value = message;
    },
    installBudget(status) {
      budget.value = status;
    },
    setRenderNotice(message) {
      renderNotice.value = message;
    },
  };
}
