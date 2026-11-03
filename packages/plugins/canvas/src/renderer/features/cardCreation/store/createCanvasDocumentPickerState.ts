import { shallowReadonly, shallowRef } from 'vue';
import type { DocumentReferenceCandidate } from '@app/schemas';
export function createCanvasDocumentPickerState() {
  const open = shallowRef(false), candidates = shallowRef<readonly DocumentReferenceCandidate[]>([]), loading = shallowRef(false), error = shallowRef<string | null>(null);
  return { open: shallowReadonly(open), candidates: shallowReadonly(candidates), loading: shallowReadonly(loading), error: shallowReadonly(error),
    show() { open.value = true; }, close() { open.value = false; }, start() { loading.value = true; error.value = null; },
    install(value: readonly DocumentReferenceCandidate[]) { candidates.value = value; loading.value = false; }, fail(message: string) { error.value = message; loading.value = false; } };
}
