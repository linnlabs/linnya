import { onScopeDispose } from 'vue';
import { useTimer } from '@linnya/renderer-ui';
import { observeDetachedInteractiveRun } from '../orchestration/observeDetachedInteractiveRun';

const OBSERVATION_INTERVAL_MS = 2_000;

function isDocumentVisible(): boolean {
  return document.visibilityState !== 'hidden';
}

/**
 * 观察寿命跟随当前 Conversation 表面；串行查询，组件销毁后不再调度。
 * 窗口不可见时只观察在途运行，不做空闲检查；重新可见时立即观察一次，
 * 让隐藏期间 CLI 等入口写入的内容在用户回来时就出现。
 */
export function useDetachedInteractiveRunObservation(
  conversationId: () => string | null | undefined
): void {
  let disposed = false;
  let running = false;
  let rerunRequested = false;
  const timer = useTimer();

  const schedule = (delay: number) => {
    timer.start(() => {
      void tick();
    }, delay);
  };
  const tick = async (): Promise<void> => {
    if (disposed) return;
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    timer.cancel();
    try {
      const id = conversationId();
      if (id) await observeDetachedInteractiveRun(id, { observeIdle: isDocumentVisible() });
    } finally {
      running = false;
    }
    if (disposed) return;
    const rerun = rerunRequested;
    rerunRequested = false;
    schedule(rerun ? 0 : OBSERVATION_INTERVAL_MS);
  };
  const onVisibilityChange = () => {
    if (isDocumentVisible()) void tick();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  schedule(OBSERVATION_INTERVAL_MS);
  onScopeDispose(() => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
}
