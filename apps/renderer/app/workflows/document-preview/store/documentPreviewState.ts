import { shallowReadonly, shallowRef } from 'vue';
import type { DocumentPreviewPresentation } from '../definitions/documentPreview';
export function createDocumentPreviewState() {
  const result = shallowRef<DocumentPreviewPresentation | null>(null),
    error = shallowRef<string | null>(null);
  return {
    // 正式正文是整份替换的快照，不把大型 JSON 和内联图片递归转成 Vue proxy。
    result: shallowReadonly(result),
    error: shallowReadonly(error),
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
