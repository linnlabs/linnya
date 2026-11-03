import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasTextCreationDraft } from '../definitions/canvasTextCreation';
import type { CanvasTextDocument } from '@plugin/canvas/shared';
export function createCanvasTextCreationState() {
  const draft = shallowRef<CanvasTextCreationDraft | null>(null), saving = shallowRef(false), error = shallowRef<string | null>(null);
  return { draft: shallowReadonly(draft), saving: shallowReadonly(saving), error: shallowReadonly(error),
    begin(value: CanvasTextCreationDraft) { draft.value = value; error.value = null; },
    update(content: CanvasTextDocument) { if (draft.value) draft.value = { ...draft.value, content, editSequence: draft.value.editSequence + 1 }; },
    measure(height: number) {
      const current = draft.value; if (!current || current.height === height) return;
      const side = current.from?.kind === 'card' ? current.from.side : 'auto';
      const y = current.anchor.y - (side === 'top' ? height : side === 'left' || side === 'right' ? height / 2 : 0);
      draft.value = { ...current, height, y };
    },
    beginSave() { saving.value = true; error.value = null; },
    fail(message: string) { saving.value = false; error.value = message; },
    clear() { draft.value = null; saving.value = false; error.value = null; },
  };
}
