import { computed } from 'vue';
import type { ConversationReferenceInput } from '@linnya/plugin-host-contract/renderer';
import { generateConversationReferenceId } from '@app/schemas';
import { createConversationReference } from '../../../functions/conversationReferences';
import { useComposerReferenceStore } from '../store/composerReferenceStore';

/**
 * Composer 引用的唯一公开动词出口。
 *
 * 引用实体构造留在 orchestration，feature store 只持有状态并执行同步 action。
 */
export function useComposerReferences() {
  const store = useComposerReferenceStore();

  return {
    references: computed(() => store.references),
    addReference: (input: ConversationReferenceInput) => {
      const id = generateConversationReferenceId();
      store.appendComposerReference(createConversationReference(input, id));
      return id;
    },
    removeReference: (id: string) => {
      store.removeComposerReference(id);
    },
    removeOwnedReference: (pluginId: string, id: string) => {
      const reference = store.references.find(candidate => candidate.id === id);
      if (!reference) return;
      if (reference.pluginId !== pluginId) {
        throw new Error(
          `[composerReferences] 插件不能移除其他 owner 的引用: owner=${pluginId}, referenceOwner=${reference.pluginId}`,
        );
      }
      store.removeComposerReference(id);
    },
    clearReferences: () => {
      store.clearComposerReferences();
    },
    removeReferencesByPluginId: (pluginId: string) => {
      store.removeComposerReferencesByPluginId(pluginId);
    },
  };
}
