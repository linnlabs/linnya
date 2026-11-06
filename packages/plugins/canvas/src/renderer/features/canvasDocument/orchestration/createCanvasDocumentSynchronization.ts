import type { CanvasDocumentSynchronizationOptions } from '../definitions/canvasDocumentSession';
import { applyCanvasSynchronization } from '../functions/applyCanvasSynchronization';
import { readCanvasProjectionChanges } from '../functions/readCanvasProjectionChanges';

/** 只拥有已提交投影的追平流程；会话切换与写请求确认仍由文档会话编排。 */
export function createCanvasDocumentSynchronization(options: CanvasDocumentSynchronizationOptions) {
  const { state, port, readSessionId } = options;
  let targetSequence = 0;
  let synchronization: Promise<void> | null = null;
  const requireDocument = () => {
    const current = state.snapshot.value;
    if (!current) throw new Error('Canvas document is not open');
    return current;
  };
  function synchronize(sequence: number): Promise<void> {
    targetSequence = Math.max(targetSequence, sequence);
    if (synchronization) return synchronization;
    const token = readSessionId();
    synchronization = (async () => {
      while (token === readSessionId()) {
        const current = requireDocument();
        if (current.sequence >= targetSequence) return;
        const update = await port.changes(current.documentId, current.sequence);
        // DTO 解码与完整投影分处短 task；关闭只使代次失效，不能取消等待者的结算。
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (token !== readSessionId()) return;
        const installed = requireDocument();
        const next = applyCanvasSynchronization(installed, update);
        if (next.sequence <= installed.sequence)
          throw new Error('Canvas synchronization made no progress');
        state.install(next, readCanvasProjectionChanges(update));
      }
    })().then(
      () => {
        if (token !== readSessionId()) return;
        synchronization = null;
        // 交回通道前再追目标，接住 loop 返回与 Promise 结算之间收到的推送。
        if (requireDocument().sequence < targetSequence) return synchronize(targetSequence);
      },
      error => {
        if (token === readSessionId()) {
          synchronization = null;
          state.fail(error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
    );
    return synchronization;
  }
  return {
    synchronize,
    catchUp: () => synchronize(targetSequence),
    observe(sequence: number) {
      targetSequence = Math.max(targetSequence, sequence);
      const current = state.snapshot.value;
      if (!current || sequence <= current.sequence) return;
      void synchronize(sequence).catch(() => {
        /* 状态已记录失败，界面提供明确重开入口。 */
      });
    },
    reset() {
      synchronization = null;
      targetSequence = 0;
    },
  };
}
