import type { useUpdateStore } from '../store/updateStore';
import type { AppUpdateApi } from '../definitions/updateRuntime';

function readApi(): AppUpdateApi | undefined {
  return typeof window !== 'undefined' ? window.electronAPI?.appUpdate : undefined;
}

/** Main 是唯一更新事实 owner，Renderer 编排只订阅快照和转发用户命令。 */
export function createUpdateActions(store: ReturnType<typeof useUpdateStore>) {
  let api: AppUpdateApi | undefined;
  let unsubscribe: (() => void) | undefined;
  async function connect(nextApi: AppUpdateApi | undefined = readApi()): Promise<void> {
    if (!nextApi || api) return;
    api = nextApi;
    unsubscribe = api.onState(next => {
      store.setState(next);
    });
    store.setState(await api.getState());
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
    if (!api || store.requestingRestart) return;
    store.setRequestingRestart(true);
    try {
      const result = await api.install({ confirmedActivityKeys: [...confirmedActivityKeys] });
      if (result.outcome === 'confirmation_required') {
        store.setConfirmation(result.activities, confirmedActivityKeys.length > 0);
        return;
      }
      store.setConfirmation(null, false);
    } finally {
      store.setRequestingRestart(false);
    }
  }

  async function confirmRestart(): Promise<void> {
    const activities = store.pendingActivities;
    if (!activities) return;
    await requestRestart(activities.map(activity => activity.key));
  }

  async function acknowledgeInstalled(): Promise<void> {
    await api?.acknowledgeInstalled();
  }
  return {
    connect,
    disconnect,
    download,
    cancelDownload,
    requestRestart,
    confirmRestart,
    acknowledgeInstalled,
  };
}
