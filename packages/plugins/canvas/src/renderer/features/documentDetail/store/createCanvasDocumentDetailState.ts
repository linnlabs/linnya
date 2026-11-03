import { shallowReadonly, shallowRef } from 'vue';

export function createCanvasDocumentDetailState() {
  const ready = shallowRef(false), notice = shallowRef<string | null>(null);
  return { ready: shallowReadonly(ready), notice: shallowReadonly(notice),
    setReady(value: boolean) { ready.value = value; },
    setNotice(value: string | null) { notice.value = value; },
  };
}
