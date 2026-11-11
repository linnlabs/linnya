import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

import type {
  AppUpdateState,
  AppUpdateActivity,
} from '../../../../../src/shared/update/definitions/updateMessage';

/**
 * Renderer 只镜像 Main 的更新快照并转发用户动作。
 * 重启前的任务确认是唯一留在 Renderer 的交互状态：Main 返回需要确认的任务列表，
 * 用户确认后带着这些 key 再次请求；期间出现的新任务会让 Main 再次要求确认。
 */
export const useUpdateStore = defineStore('update', () => {
  const state = shallowRef<AppUpdateState | null>(null);
  const pendingActivities = shallowRef<readonly AppUpdateActivity[] | null>(null);
  const activitiesChanged = ref(false);
  const requestingRestart = ref(false);

  const status = computed(() => state.value?.status ?? 'idle');
  /** 入口只在官方发行版且确有更新相关状态时出现。 */
  const entryVisible = computed(() => Boolean(state.value?.enabled) && status.value !== 'idle');

  function setState(next: AppUpdateState): void {
    state.value = next;
  }
  function setRequestingRestart(value: boolean): void {
    requestingRestart.value = value;
  }
  function setConfirmation(
    activities: readonly AppUpdateActivity[] | null,
    changed: boolean
  ): void {
    pendingActivities.value = activities;
    activitiesChanged.value = changed;
  }

  function declineRestart(): void {
    pendingActivities.value = null;
    activitiesChanged.value = false;
  }

  return {
    state,
    status,
    entryVisible,
    pendingActivities,
    activitiesChanged,
    requestingRestart,
    declineRestart,
    setState,
    setRequestingRestart,
    setConfirmation,
  };
});
