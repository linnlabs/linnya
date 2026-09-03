import { computed, type ComputedRef } from 'vue';
import type {
  ConversationInputAccessoryComposerCommands,
  ConversationInputAccessoryContribution,
} from '@linnya/plugin-host-contract/renderer';
import { useComposerReferences } from '../../composer-references';
import type { ConversationInputAccessoryViewModel } from '../definitions/conversationInputAccessoryViewModel';
import { resolveVisibleConversationInputAccessories } from '../functions/resolveVisibleConversationInputAccessories';
import { readConversationInputAccessories } from '../registry/conversationInputAccessoryRegistry';

export interface UseConversationInputAccessoriesOptions {
  readonly isBlockedByInputExtension: () => boolean;
}

function createOwnerBoundComposerCommands(
  contribution: ConversationInputAccessoryContribution,
  composerReferences: ReturnType<typeof useComposerReferences>,
): ConversationInputAccessoryComposerCommands {
  return {
    addReference(input) {
      return composerReferences.addReference({
        ...input,
        pluginId: contribution.pluginId,
      });
    },
    removeReference(referenceId) {
      composerReferences.removeOwnedReference(contribution.pluginId, referenceId);
    },
  };
}

export function useConversationInputAccessories(
  options: UseConversationInputAccessoriesOptions,
): ComputedRef<readonly ConversationInputAccessoryViewModel[]> {
  const composerReferences = useComposerReferences();

  return computed(() => resolveVisibleConversationInputAccessories(
    readConversationInputAccessories(),
    options.isBlockedByInputExtension(),
  ).map(contribution => ({
    key: `${contribution.pluginId}:${contribution.id}`,
    component: contribution.component,
    composer: createOwnerBoundComposerCommands(contribution, composerReferences),
  })));
}
