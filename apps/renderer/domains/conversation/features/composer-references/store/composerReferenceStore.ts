import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ConversationReference } from '../../../types';

/** Composer 引用的 feature 级状态，只持有状态并执行同步更新。 */
export const useComposerReferenceStore = defineStore('conversation-composer-references', () => {
  const references = ref<ConversationReference[]>([]);

  const appendComposerReference = (reference: ConversationReference) => {
    references.value.push(reference);
  };

  const removeComposerReference = (id: string) => {
    references.value = references.value.filter(reference => reference.id !== id);
  };

  const clearComposerReferences = () => {
    references.value = [];
  };

  const removeComposerReferencesByPluginId = (pluginId: string) => {
    references.value = references.value.filter(reference => reference.pluginId !== pluginId);
  };

  return {
    references,
    appendComposerReference,
    removeComposerReference,
    clearComposerReferences,
    removeComposerReferencesByPluginId,
  };
});
