import { shallowReadonly, shallowRef } from 'vue';
import type { DocumentPreviewPresentation } from '../definitions/documentPreview';
export function createDocumentPreviewState() {
  const result = shallowRef<DocumentPreviewPresentation | null>(null),
    error = shallowRef<string | null>(null);
  // 刷新由 watchEffect 触发：在里面读 result 会把自己的结果变成依赖，读完又多读一遍。
  let shown: DocumentPreviewPresentation | null = null;
  const show = (value: DocumentPreviewPresentation | null) => {
    shown = value;
    result.value = value;
  };
  return {
    // 正式正文是整份替换的快照，不把大型 JSON 和内联图片递归转成 Vue proxy。
    result: shallowReadonly(result),
    error: shallowReadonly(error),
    peek: () => shown,
    loading() {
      show(null);
      error.value = null;
    },
    loaded(value: DocumentPreviewPresentation) {
      show(value);
    },
    failed(value: string) {
      show(null);
      error.value = value;
    },
    clear() {
      show(null);
      error.value = null;
    },
  };
}
