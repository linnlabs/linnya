import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type {
  UpdateMessageChannel,
  UpdateMessagePayload,
  UpdateProgressInfo,
  UpdateStatus,
  UpdateVersionInfo,
} from '../../../../../src/shared/update/definitions/updateMessage';
import type { UpdateErrorInfo, UpdateInvokeChannel } from '../definitions/updateState';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toVersionInfo(payload: UpdateMessagePayload): UpdateVersionInfo | null {
  if (!isRecord(payload)) return null;

  return {
    version: typeof payload.version === 'string' ? payload.version : undefined,
    releaseName: typeof payload.releaseName === 'string' ? payload.releaseName : undefined,
    releaseNotes: typeof payload.releaseNotes === 'string' ? payload.releaseNotes : undefined,
    releaseDate: typeof payload.releaseDate === 'string' ? payload.releaseDate : undefined,
  };
}

function toProgressInfo(payload: UpdateMessagePayload): UpdateProgressInfo {
  if (!isRecord(payload)) return {};

  return {
    percent: typeof payload.percent === 'number' ? payload.percent : undefined,
    total: typeof payload.total === 'number' ? payload.total : undefined,
    bytesPerSecond: typeof payload.bytesPerSecond === 'number' ? payload.bytesPerSecond : undefined,
    transferred: typeof payload.transferred === 'number' ? payload.transferred : undefined,
  };
}

function toErrorInfo(payload: UpdateMessagePayload): UpdateErrorInfo {
  if (typeof payload === 'string') return { kind: 'dynamic', message: payload };
  if (payload === null || payload === undefined) return null;
  return { kind: 'dynamic', message: JSON.stringify(payload) };
}

async function invokeUpdater(channel: UpdateInvokeChannel): Promise<unknown | null> {
  const result = window.electronAPI.invoke(channel);
  if (!result) {
    return null;
  }
  return result;
}

export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus>('idle');
  const versionInfo = ref<UpdateVersionInfo | null>(null);
  const progressInfo = ref<UpdateProgressInfo | null>(null);
  const errorInfo = ref<UpdateErrorInfo>(null);

  /**
   * 开发环境策略：
   * - 开发环境需要“随时弹窗 + 保留日志”，用于观察生产用户将看到的更新日志内容。
   * - 因此在 dev 下我们不会在 update-not-available 后自动回 idle，也不会清空 versionInfo。
   */
  const isDev = !!import.meta.env.DEV;

  const lastProgressTime = ref<number | null>(null);
  const lastTransferredBytes = ref(0);

  const updateAvailable = computed(() => status.value === 'available');
  const isDownloading = computed(() => status.value === 'downloading');
  const isInstalling = computed(() => status.value === 'installing');
  const updateDownloaded = computed(() => status.value === 'downloaded');
  const hasError = computed(() => status.value === 'error');

  function resetProgressTracking(): void {
    lastProgressTime.value = null;
    lastTransferredBytes.value = 0;
  }

  /**
   * 处理主进程推送的更新状态。
   * 中文说明：所有 payload 先做结构化收窄，避免把 electron-updater 的松散对象直接塞进 UI 状态。
   */
  function handleIpc(channel: UpdateMessageChannel, payload?: UpdateMessagePayload): void {
    console.log(`[UpdateStore] Received IPC. Channel: ${channel}. Payload:`, payload);
    console.log(`[UpdateStore] State BEFORE update: status=${status.value}`);

    switch (channel) {
      case 'checking-for-update':
        status.value = 'checking';
        progressInfo.value = null;
        errorInfo.value = null;
        if (!isDev) {
          versionInfo.value = null;
        }
        break;
      case 'update-available':
        status.value = 'available';
        versionInfo.value = toVersionInfo(payload);
        break;
      case 'update-not-available':
        status.value = 'not-available';
        versionInfo.value = toVersionInfo(payload);
        progressInfo.value = null;
        if (!isDev) {
          setTimeout(() => {
            if (status.value === 'not-available') {
              status.value = 'idle';
            }
          }, 3000);
        }
        break;
      case 'download-progress': {
        status.value = 'downloading';
        const currentTime = Date.now();
        const parsedProgress = toProgressInfo(payload);
        const currentTransferredBytes = parsedProgress.transferred ?? 0;
        let instantSpeed = 0;

        if (lastProgressTime.value !== null) {
          const timeDiff = (currentTime - lastProgressTime.value) / 1000;
          const byteDiff = currentTransferredBytes - lastTransferredBytes.value;

          if (timeDiff > 0) {
            instantSpeed = byteDiff / timeDiff;
          }
        }

        lastProgressTime.value = currentTime;
        lastTransferredBytes.value = currentTransferredBytes;
        progressInfo.value = {
          ...parsedProgress,
          instantSpeed,
        };
        break;
      }
      case 'update-downloaded':
        status.value = 'downloaded';
        progressInfo.value = null;
        resetProgressTracking();
        break;
      case 'installing':
        status.value = 'installing';
        progressInfo.value = null;
        errorInfo.value = null;
        resetProgressTracking();
        break;
      case 'error':
        status.value = 'error';
        errorInfo.value = toErrorInfo(payload);
        progressInfo.value = null;
        versionInfo.value = null;
        resetProgressTracking();
        break;
    }

    console.log(`[UpdateStore] State AFTER update: status=${status.value}`);
  }

  async function checkForUpdates(): Promise<void> {
    status.value = 'checking';
    errorInfo.value = null;
    const result = await invokeUpdater('updater-check-for-updates');
    if (result === null) {
      status.value = 'error';
      errorInfo.value = {
        kind: 'ipc-unavailable',
        channel: 'updater-check-for-updates',
      };
    }
  }

  async function startDownload(): Promise<void> {
    if (status.value !== 'available') return;

    status.value = 'downloading';
    errorInfo.value = null;
    try {
      console.log('[UpdateStore] Invoking updater-start-download...');
      const result = await invokeUpdater('updater-start-download');
      if (result === null) {
        status.value = 'error';
        errorInfo.value = {
          kind: 'ipc-unavailable',
          channel: 'updater-start-download',
        };
        return;
      }
      console.log('[UpdateStore] updater-start-download invoked successfully.');
    } catch (err: unknown) {
      console.error('[UpdateStore] Error invoking updater-start-download:', err);
      status.value = 'error';
      errorInfo.value = err instanceof Error
        ? {
            kind: 'dynamic',
            message: err.message,
          }
        : null;
    }
  }

  async function quitAndInstall(): Promise<void> {
    if (status.value !== 'downloaded' && status.value !== 'installing') return;

    status.value = 'installing';
    const result = await invokeUpdater('updater-quit-and-install');
    if (result === null) {
      status.value = 'error';
      errorInfo.value = {
        kind: 'ipc-unavailable',
        channel: 'updater-quit-and-install',
      };
    }
  }

  function reset(): void {
    status.value = 'idle';
    versionInfo.value = null;
    progressInfo.value = null;
    errorInfo.value = null;
    resetProgressTracking();
  }

  return {
    status,
    versionInfo,
    progressInfo,
    errorInfo,
    updateAvailable,
    isDownloading,
    isInstalling,
    updateDownloaded,
    hasError,
    handleIpc,
    checkForUpdates,
    startDownload,
    quitAndInstall,
    reset,
  };
});
