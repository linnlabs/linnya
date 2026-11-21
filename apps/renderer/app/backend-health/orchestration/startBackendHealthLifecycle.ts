import { useBackendHealthStore } from '../store/backendHealthStore';

/** 先订阅 Main 的状态推送，再读一次快照；页面重载也能取回当前状态。 */
export function startBackendHealthLifecycle(): () => void {
  const api = window.electronAPI?.appServerHealth;
  if (!api) return () => undefined;
  const store = useBackendHealthStore();
  const stop = api.onState(state => store.applyStatus(state.status));
  void api.getState().then(
    state => store.applyStatus(state.status),
    (error: unknown) => console.warn('[backend-health] 读取后台服务状态失败', error),
  );
  return stop;
}
