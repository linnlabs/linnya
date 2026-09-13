import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { TextEditingTarget } from '../definitions/textEditingTypes';

export const useSlidesTextEditingStore = defineStore('slides-text-editing', () => {
  const target = shallowRef<TextEditingTarget | null>(null);
  const draft = ref('');
  const composing = ref(false);

  function open(next: TextEditingTarget): void {
    target.value = next;
    draft.value = next.content;
    composing.value = false;
  }

  function updateDraft(value: string): void {
    draft.value = value;
  }

  function setComposing(value: boolean): void {
    composing.value = value;
  }

  function reconcileTarget(next: TextEditingTarget | null): void {
    if (!target.value) return;
    if (!next || next.elementId !== target.value.elementId) {
      close();
      return;
    }
    target.value = next;
  }

  function close(): void {
    target.value = null;
    draft.value = '';
    composing.value = false;
  }

  return {
    target,
    draft,
    composing,
    open,
    updateDraft,
    setComposing,
    reconcileTarget,
    close,
    $reset: close,
  };
});

