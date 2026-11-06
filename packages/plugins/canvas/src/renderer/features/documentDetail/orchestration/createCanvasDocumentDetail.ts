import type {
  CanvasDocumentDetailCard,
  CanvasDocumentDetailPort,
} from '../definitions/documentDetail';
import { createCanvasDocumentDetailState } from '../store/createCanvasDocumentDetailState';

/** Host 拥有身份/插件失效与只读正文；本层只拥有一张卡的 DOM 挂载。 */
export function createCanvasDocumentDetail(options: {
  readonly card: CanvasDocumentDetailCard;
  readonly projectId: string;
  readonly element: HTMLElement;
  readonly port: CanvasDocumentDetailPort;
}) {
  const state = createCanvasDocumentDetailState(),
    cancellation = new AbortController();
  let disposed = false,
    release: (() => void) | null = null;
  async function mount() {
    try {
      const precision = await options.port.prepare(options.card.id);
      if (disposed) return;
      if (precision === 'unavailable') state.setNotice('精确预览暂不可用，已继续显示只读详情。');
      const unmount = await options.port.mount({
        element: options.element,
        documentId: options.card.data.documentId,
        projectId: options.projectId,
        signal: cancellation.signal,
      });
      if (disposed) {
        unmount();
        return;
      }
      release = unmount;
      options.port.visible(options.card.id, true);
      state.setReady(true);
    } catch (error) {
      if (!disposed) state.setNotice(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    state,
    mount,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancellation.abort();
      release?.();
      release = null;
      options.port.visible(options.card.id, false);
      state.setReady(false);
    },
  };
}
