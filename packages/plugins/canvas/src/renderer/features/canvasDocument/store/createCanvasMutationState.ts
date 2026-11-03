import { shallowReadonly, shallowRef } from 'vue';
export function createCanvasMutationState() {
  const notice = shallowRef<string | null>(null);
  return { notice: shallowReadonly(notice), setNotice(message: string | null) { notice.value = message; } };
}
