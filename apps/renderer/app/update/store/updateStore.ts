import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

import type {
  AppUpdateState,
  AppUpdateActivity,
} from '../../../../../src/shared/update/definitions/updateMessage';

type AppUpdateApi = Window['electronAPI']['appUpdate'];

function readApi(): AppUpdateApi | undefined {
  return typeof window !== 'undefined' ? window.electronAPI?.appUpdate : undefined;
}

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
  let api: AppUpdateApi | undefined;
  let unsubscribe: (() => void) | undefined;

  const status = computed(() => state.value?.status ?? 'idle');
  /** 入口只在官方发行版且确有更新相关状态时出现。 */
  const entryVisible = computed(() => Boolean(state.value?.enabled) && status.value !== 'idle');

  async function connect(nextApi: AppUpdateApi | undefined = readApi()): Promise<void> {
    if (!nextApi || api) return;
    api = nextApi;
    unsubscribe = api.onState(next => { state.value = next; });
    state.value = await api.getState();
  }

  function disconnect(): void {
    unsubscribe?.();
    unsubscribe = undefined;
    api = undefined;
  }

  async function download(): Promise<void> {
    await api?.download();
  }

  async function cancelDownload(): Promise<void> {
    await api?.cancelDownload();
  }

  async function requestRestart(confirmedActivityKeys: readonly string[] = []): Promise<void> {
    if (!api || requestingRestart.value) return;
    requestingRestart.value = true;
    try {
      const result = await api.install({ confirmedActivityKeys: [...confirmedActivityKeys] });
      if (result.outcome === 'confirmation_required') {
        activitiesChanged.value = confirmedActivityKeys.length > 0;
        pendingActivities.value = result.activities;
        return;
      }
      pendingActivities.value = null;
      activitiesChanged.value = false;
    } finally {
      requestingRestart.value = false;
    }
  }

  async function confirmRestart(): Promise<void> {
    const activities = pendingActivities.value;
    if (!activities) return;
    await requestRestart(activities.map(activity => activity.key));
  }

  function declineRestart(): void {
    pendingActivities.value = null;
    activitiesChanged.value = false;
  }

  async function acknowledgeInstalled(): Promise<void> {
    await api?.acknowledgeInstalled();
  }

  return {
    state,
    status,
    entryVisible,
    pendingActivities,
    activitiesChanged,
    requestingRestart,
    connect,
    disconnect,
    download,
    cancelDownload,
    requestRestart,
    confirmRestart,
    declineRestart,
    acknowledgeInstalled,
  };
});
