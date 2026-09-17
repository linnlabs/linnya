import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { TextDraftPresentation, TextInputSession } from '../definitions/editingInteractionTypes';

export const useSlidesEditingInteractionStore = defineStore('slides-editing-interaction', () => {
  const textSession = shallowRef<TextInputSession>({ phase: 'idle' });
  const textDrafts = shallowRef<readonly TextDraftPresentation[]>([]);

  function setTextSession(session: TextInputSession): void { textSession.value = session; }
  function setTextDrafts(drafts: readonly TextDraftPresentation[]): void { textDrafts.value = drafts; }
  function $reset(): void {
    textSession.value = { phase: 'idle' };
    textDrafts.value = [];
  }
  return { textSession, textDrafts, setTextSession, setTextDrafts, $reset };
});
