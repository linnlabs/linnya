import { readonly, shallowRef } from 'vue';
import type { DocumentPreviewPresentation } from '../definitions/documentPreview';
export function createDocumentPreviewState() {
  const result = shallowRef<DocumentPreviewPresentation | null>(null),
    error = shallowRef<string | null>(null);
  return {
    result: readonly(result),
    error: readonly(error),
    loading() {
      result.value = null;
      error.value = null;
    },
    loaded(value: DocumentPreviewPresentation) {
      result.value = value;
    },
    failed(value: string) {
      result.value = null;
      error.value = value;
    },
    clear() {
      result.value = null;
      error.value = null;
    },
  };
}
