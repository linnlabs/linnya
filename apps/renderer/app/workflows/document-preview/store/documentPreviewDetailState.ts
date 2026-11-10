import { readonly, shallowRef } from 'vue';
import type { DocumentPreviewDetailPhase } from '../definitions/documentPreviewDetail';
export function createDocumentPreviewDetailState() {
  const phase = shallowRef<DocumentPreviewDetailPhase>('idle');
  return {
    phase: readonly(phase),
    set(value: DocumentPreviewDetailPhase) {
      phase.value = value;
    },
  };
}
