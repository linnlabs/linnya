import { defineStore } from 'pinia';
import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import { getWorkspaceScopeKey } from '../../../../shared/stores/workspaceScopeStore';
import type { ConversationBatchSelectionState } from '../definitions/conversationSelection';

function emptySelection(): ConversationBatchSelectionState {
  return { selectedIds: [], anchorId: null };
}

export const useConversationSelectionStore = defineStore('conversation-selection', {
  state: () => ({ selections: {} as Record<string, ConversationBatchSelectionState> }),
  getters: {
    batchSelectedConversationIds: (state) => (scope: WorkspaceScope): readonly string[] => (
      state.selections[getWorkspaceScopeKey(scope)]?.selectedIds ?? []
    ),
  },
  actions: {
    readSelection(scope: WorkspaceScope): ConversationBatchSelectionState {
      return this.selections[getWorkspaceScopeKey(scope)] ?? emptySelection();
    },
    replaceSelection(scope: WorkspaceScope, selection: ConversationBatchSelectionState): void {
      this.selections[getWorkspaceScopeKey(scope)] = selection;
    },
    remove(scope: WorkspaceScope, conversationId: string): void {
      const selection = this.readSelection(scope);
      this.replaceSelection(scope, {
        selectedIds: selection.selectedIds.filter(id => id !== conversationId),
        anchorId: selection.anchorId === conversationId ? null : selection.anchorId,
      });
    },
    clear(scope: WorkspaceScope): void {
      this.replaceSelection(scope, emptySelection());
    },
  },
});
