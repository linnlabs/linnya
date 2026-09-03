import { loadModelPicker } from './modelPickerOperations';

let unsubscribeFromBackendUpdates: (() => void) | null = null;

/** 启动 Host 组合读模型，并在 Cloud catalog 更新后重新投影运行可用性。 */
export async function startModelPickerLifecycle(): Promise<void> {
  if (!unsubscribeFromBackendUpdates) {
    unsubscribeFromBackendUpdates =
      window.electronAPI.on('models-updated', () => {
        void loadModelPicker().catch(error => {
          console.warn('[ModelPicker] 主进程刷新信号处理失败', error);
        });
      }) ?? null;
  }
  await loadModelPicker();
}

export function stopModelPickerLifecycle(): void {
  unsubscribeFromBackendUpdates?.();
  unsubscribeFromBackendUpdates = null;
}
