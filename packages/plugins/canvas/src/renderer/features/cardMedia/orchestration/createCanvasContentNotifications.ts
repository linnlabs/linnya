import { CANVAS_CONTENT_NOTIFICATION_INTERVAL_MS } from '../definitions/cardMedia';

/** 只合并成功资源通知；失效和失败立即交付，避免界面暂留旧身份内容。 */
export function createCanvasContentNotifications() {
  const listeners = new Set<(failure: Error | null) => void>();
  let notification: ReturnType<typeof setTimeout> | null = null;
  const notify = (failure: Error | null) => {
    for (const listener of listeners) listener(failure);
  };
  const cancel = () => {
    if (notification !== null) clearTimeout(notification);
    notification = null;
  };
  return {
    changed(failure: Error | null) {
      if (failure) {
        notify(failure);
        return;
      }
      // 资源读取继续推进；正文计算不进入绘制 RAF。
      if (notification === null)
        notification = setTimeout(() => {
          notification = null;
          notify(null);
        }, CANVAS_CONTENT_NOTIFICATION_INTERVAL_MS);
    },
    invalidate() {
      cancel();
      notify(null);
    },
    subscribe(listener: (failure: Error | null) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      cancel();
      listeners.clear();
    },
  };
}
