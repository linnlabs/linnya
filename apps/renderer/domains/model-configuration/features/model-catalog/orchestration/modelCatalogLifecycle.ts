import { loadModelCatalog } from './modelCatalogOperations';

let unsubscribeFromBackendUpdates: (() => void) | null = null;

/** 启动目录读取，并把主进程事件作为“重新读取”信号而不是第二份数据源。 */
export async function startModelCatalogLifecycle(): Promise<void> {
  if (!unsubscribeFromBackendUpdates) {
    unsubscribeFromBackendUpdates = window.electronAPI.on('models-updated', () => {
      void loadModelCatalog().catch(error => {
        console.warn('[ModelCatalog] 主进程刷新信号处理失败', error);
      });
    }) ?? null;
  }
  await loadModelCatalog();
}

export function stopModelCatalogLifecycle(): void {
  unsubscribeFromBackendUpdates?.();
  unsubscribeFromBackendUpdates = null;
}
