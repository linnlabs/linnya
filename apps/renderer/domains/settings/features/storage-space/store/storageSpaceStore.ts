import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StorageSpaceOverviewResponse } from '@app/schemas';

export type StorageSpaceLoadState = 'idle' | 'loading' | 'ready' | 'failed';
export type StorageSpaceClearFailure = 'not_found' | 'deletion_in_progress' | 'failed';
export interface StorageSpaceClearFailureEntry {
  readonly conversationId: string;
  readonly failure: StorageSpaceClearFailure;
}

export const useStorageSpaceStore = defineStore('storage-space', () => {
  const loadState = ref<StorageSpaceLoadState>('idle');
  const overview = ref<StorageSpaceOverviewResponse>();
  const pendingConversationIds = ref<readonly string[]>([]);
  const clearFailures = ref<readonly StorageSpaceClearFailureEntry[]>([]);

  function withoutFailure(conversationId: string): readonly StorageSpaceClearFailureEntry[] {
    return clearFailures.value.filter(entry => entry.conversationId !== conversationId);
  }

  function beginLoad(): void {
    loadState.value = 'loading';
  }

  function loadSucceeded(next: StorageSpaceOverviewResponse): void {
    overview.value = next;
    loadState.value = 'ready';
  }

  function loadFailed(): void {
    loadState.value = 'failed';
  }

  function beginClear(conversationId: string): void {
    if (!pendingConversationIds.value.includes(conversationId)) {
      pendingConversationIds.value = [...pendingConversationIds.value, conversationId];
    }
    clearFailures.value = withoutFailure(conversationId);
  }

  function clearSucceeded(conversationId: string): void {
    pendingConversationIds.value = pendingConversationIds.value.filter(id => id !== conversationId);
    clearFailures.value = withoutFailure(conversationId);
  }

  function clearFailed(conversationId: string, failure: StorageSpaceClearFailure): void {
    pendingConversationIds.value = pendingConversationIds.value.filter(id => id !== conversationId);
    clearFailures.value = [...withoutFailure(conversationId), { conversationId, failure }];
  }

  function isPending(conversationId: string): boolean {
    return pendingConversationIds.value.includes(conversationId);
  }

  function failureFor(conversationId: string): StorageSpaceClearFailure | undefined {
    return clearFailures.value.find(entry => entry.conversationId === conversationId)?.failure;
  }

  return {
    loadState,
    overview,
    pendingConversationIds,
    clearFailures,
    beginLoad,
    loadSucceeded,
    loadFailed,
    beginClear,
    clearSucceeded,
    clearFailed,
    isPending,
    failureFor,
  };
});
