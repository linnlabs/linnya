import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasImageDraft, CanvasImageEditingState } from '../definitions/canvasImageEditing';
export function createCanvasImageEditingState(): CanvasImageEditingState {
  const draft = shallowRef<CanvasImageDraft | null>(null),
    busy = shallowRef(false),
    error = shallowRef<string | null>(null);
  return {
    draft: shallowReadonly(draft),
    busy: shallowReadonly(busy),
    error: shallowReadonly(error),
    begin(card) {
      draft.value = { card, data: { ...card.data }, asset: null };
      error.value = null;
    },
    patch(data) {
      if (draft.value) draft.value = { ...draft.value, data: { ...draft.value.data, ...data } };
    },
    installAsset(asset, data) {
      if (draft.value) draft.value = { ...draft.value, asset, data };
    },
    setBusy(value) {
      busy.value = value;
    },
    fail(message) {
      error.value = message;
    },
    clear() {
      draft.value = null;
      busy.value = false;
      error.value = null;
    },
  };
}
