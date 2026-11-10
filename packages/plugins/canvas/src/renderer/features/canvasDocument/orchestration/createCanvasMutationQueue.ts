import {
  CanvasDeliveryUnknownError,
  type CanvasConfirmedMutation,
} from '../definitions/canvasMutation';
import { canvasText } from '../../localization';
import { createCanvasMutationState } from '../store/createCanvasMutationState';

/** 当前视图的写确认通道。结果不确定时保留原调用等待显式确认，后续意图不能越过它。 */
export function createCanvasMutationQueue() {
  const state = createCanvasMutationState();
  let generation = 0,
    tail: Promise<unknown> = Promise.resolve();
  let active: { retry(): Promise<void>; cancel(): void } | null = null;
  function execute<T>(operation: CanvasConfirmedMutation<T>): Promise<T> {
    const token = generation;
    const result = tail.then(() => {
      if (token !== generation) throw new DOMException('Canvas session closed', 'AbortError');
      state.setPending(true);
      return new Promise<T>((resolve, reject) => {
        let received: { readonly value: T } | null = null,
          running = false,
          settled = false;
        const finish = () => {
          settled = true;
          if (active === attempt) active = null;
          state.setNotice(null);
          state.setPending(false);
        };
        const attempt = {
          async retry() {
            if (running || settled) return;
            running = true;
            state.setNotice(null);
            try {
              received ??= { value: await operation.send() };
              if (settled || token !== generation) return;
              await operation.accept(received.value);
              if (settled || token !== generation) return;
              finish();
              resolve(received.value);
            } catch (failure) {
              if (settled || token !== generation) return;
              if (received || failure instanceof CanvasDeliveryUnknownError) {
                state.setNotice(
                  canvasText(
                    received ? 'canvas.error.unsyncedAfterCommit' : 'canvas.error.unconfirmedCommit'
                  )
                );
              } else {
                finish();
                reject(failure);
              }
            } finally {
              running = false;
            }
          },
          cancel() {
            if (!settled) {
              finish();
              reject(new DOMException('Canvas session closed', 'AbortError'));
            }
          },
        };
        active = attempt;
        void attempt.retry();
      });
    });
    tail = result.catch(() => undefined);
    return result;
  }
  return {
    state,
    execute,
    retry: async () => {
      await active?.retry();
    },
    reset() {
      generation += 1;
      active?.cancel();
      active = null;
      state.setNotice(null);
      state.setPending(false);
      tail = Promise.resolve();
    },
  };
}
