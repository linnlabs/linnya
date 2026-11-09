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
      // 精确图只影响退出详情时位图与正文能否无缝衔接；拿不到也照常显示详情，不打扰用户。
      await options.port.prepare(options.card.id);
      if (disposed) return;
      const unmount = await options.port.mount({
        element: options.element,
        documentId: options.card.data.documentId,
        projectId: options.projectId,
        signal: cancellation.signal,
        mode: 'detail',
        onReady: () => {
          if (disposed) return;
          options.port.visible(options.card.id, true);
          state.setReady(true);
        },
      });
      if (disposed) {
        unmount();
        return;
      }
      release = unmount;
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
