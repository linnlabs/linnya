import { onScopeDispose } from 'vue';
import { observeDetachedInteractiveRun } from '../orchestration/observeDetachedInteractiveRun';

/** 观察寿命跟随当前 Conversation 表面；串行查询，组件销毁后不再调度。 */
export function useDetachedInteractiveRunObservation(
  conversationId: () => string | null | undefined
): void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    const id = conversationId();
    if (id) await observeDetachedInteractiveRun(id);
    if (!disposed)
      timer = setTimeout(() => {
        void tick();
      }, 2_000);
  };
  timer = setTimeout(() => {
    void tick();
  }, 2_000);
  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
  });
}
