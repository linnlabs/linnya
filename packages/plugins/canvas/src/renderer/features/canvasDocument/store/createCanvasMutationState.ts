import { shallowReadonly, shallowRef } from 'vue';
export function createCanvasMutationState() {
  const notice = shallowRef<string | null>(null);
  const pending = shallowRef(false);
  return { notice: shallowReadonly(notice), pending: shallowReadonly(pending), setNotice(message: string | null) { notice.value = message; }, setPending(value: boolean) { pending.value = value; } };
}
