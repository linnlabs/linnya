import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  CommandCardControlPageSnapshotV1,
  CommandProcessHandle,
} from '@app/schemas/commands';

export const useCommandCardControlStore = defineStore('command-card-control', () => {
  const snapshot = ref<CommandCardControlPageSnapshotV1>();
  const cancellingHandle = ref<CommandProcessHandle>();
  const failedHandle = ref<CommandProcessHandle>();
  const pageUnavailable = ref(false);

  function replaceSnapshot(next: CommandCardControlPageSnapshotV1): void {
    const previousPageTicket = snapshot.value?.page_ticket;
    snapshot.value = next;
    pageUnavailable.value = false;
    if (
      previousPageTicket !== next.page_ticket
      || !next.capabilities.some(value => value.process_handle === failedHandle.value)
    ) {
      // 同页重签 ticket 时保留刚发生的失败提示；切页或进入终态后才清除。
      failedHandle.value = undefined;
    }
    if (
      previousPageTicket !== next.page_ticket
      || !next.capabilities.some(value => value.process_handle === cancellingHandle.value)
    ) {
      // “取消中”属于当前 renderer 页；reload 后旧请求即使仍在飞行，也不能锁住新页按钮。
      cancellingHandle.value = undefined;
    }
  }

  function cancelStarted(handle: CommandProcessHandle): void {
    cancellingHandle.value = handle;
    failedHandle.value = undefined;
  }

  function cancelFinished(handle: CommandProcessHandle, failed: boolean): void {
    if (cancellingHandle.value === handle) cancellingHandle.value = undefined;
    failedHandle.value = failed ? handle : undefined;
  }

  function reset(): void {
    snapshot.value = undefined;
    cancellingHandle.value = undefined;
    failedHandle.value = undefined;
    pageUnavailable.value = false;
  }

  function markPageUnavailable(): void {
    snapshot.value = undefined;
    cancellingHandle.value = undefined;
    pageUnavailable.value = true;
  }

  return {
    snapshot,
    cancellingHandle,
    failedHandle,
    pageUnavailable,
    replaceSnapshot,
    cancelStarted,
    cancelFinished,
    reset,
    markPageUnavailable,
  };
});
