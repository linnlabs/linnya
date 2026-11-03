import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasCardDraft, CanvasCardEditingState } from '../definitions/cardEditing';

export function createCardEditingState(): CanvasCardEditingState {
  const draft = shallowRef<CanvasCardDraft | null>(null);
  const saving = shallowRef(false);
  const error = shallowRef<string | null>(null);
  return {
    draft: shallowReadonly(draft), saving: shallowReadonly(saving), error: shallowReadonly(error),
    begin(card, historyGroupId) { draft.value = { elementId: card.id, content: card.data.content, baseRevision: card.revision, editSequence: 0, savedSequence: 0, historyGroupId, measuredHeight: null }; error.value = null; },
    update(content) { if (draft.value) draft.value = { ...draft.value, content, editSequence: draft.value.editSequence + 1 }; },
    measure(height) { if (draft.value) draft.value = { ...draft.value, measuredHeight: height }; },
    beginSave() { saving.value = true; error.value = null; },
    saved(baseRevision, savedSequence) { if (draft.value) draft.value = { ...draft.value, baseRevision, savedSequence }; saving.value = false; },
    failed(message) { saving.value = false; error.value = message; },
    clear() { draft.value = null; saving.value = false; error.value = null; },
  };
}
