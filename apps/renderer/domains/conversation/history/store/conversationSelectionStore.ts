import { defineStore } from 'pinia';
import type { NavigationScope } from '@/app/navigation';
import { getNavigationScopeKey } from '@/app/navigation';
import type { ConversationBatchSelectionState } from '../definitions/conversationSelection';

function emptySelection(): ConversationBatchSelectionState {
  return { selectedIds: [], anchorId: null };
}

export const useConversationSelectionStore = defineStore('conversation-selection', {
  state: () => ({ selections: {} as Record<string, ConversationBatchSelectionState> }),
  getters: {
    batchSelectedConversationIds: (state) => (scope: NavigationScope): readonly string[] => (
      state.selections[getNavigationScopeKey(scope)]?.selectedIds ?? []
    ),
  },
  actions: {
    readSelection(scope: NavigationScope): ConversationBatchSelectionState {
      return this.selections[getNavigationScopeKey(scope)] ?? emptySelection();
    },
    replaceSelection(scope: NavigationScope, selection: ConversationBatchSelectionState): void {
      this.selections[getNavigationScopeKey(scope)] = selection;
    },
    remove(scope: NavigationScope, conversationId: string): void {
      const selection = this.readSelection(scope);
      this.replaceSelection(scope, {
        selectedIds: selection.selectedIds.filter(id => id !== conversationId),
        anchorId: selection.anchorId === conversationId ? null : selection.anchorId,
      });
    },
    clear(scope: NavigationScope): void {
      this.replaceSelection(scope, emptySelection());
    },
  },
});
