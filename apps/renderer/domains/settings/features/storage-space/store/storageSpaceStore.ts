import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StorageSpaceOverviewResponse } from '@app/schemas';

export type StorageSpaceLoadState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * 设置里的存储空间只看总量和分类。每个对话的占用与清理在项目概览的对话页。
 */
export const useStorageSpaceStore = defineStore('storage-space', () => {
  const loadState = ref<StorageSpaceLoadState>('idle');
  const overview = ref<StorageSpaceOverviewResponse>();

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

  return {
    loadState,
    overview,
    beginLoad,
    loadSucceeded,
    loadFailed,
  };
});
