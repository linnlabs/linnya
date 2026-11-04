import type { CanvasCardMediaPort, CanvasPreviewReadPurpose, CanvasPreviewReadWaiter } from '../definitions/cardMedia';
import { CANVAS_DOCUMENT_PREVIEW_CONCURRENCY } from '../definitions/cardMedia';

/** 只约束真实Host传输；结果变代后的重读必须在原槽位释放后进行，避免互等。 */
export function createCanvasPreviewRequests(preview: CanvasCardMediaPort['preview']) {
  const waiting: CanvasPreviewReadWaiter[] = [];
  let active = 0, disposed = false;
  function acquire(purpose: CanvasPreviewReadPurpose) {
    if (disposed) return Promise.reject(new DOMException('Canvas previews disposed', 'AbortError'));
    if (active < CANVAS_DOCUMENT_PREVIEW_CONCURRENCY) { active++; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => { waiting.push({ purpose, resolve, reject }); });
  }
  function release() {
    const foreground = waiting.findIndex(request => request.purpose === 'foreground');
    const next = waiting.splice(foreground < 0 ? 0 : foreground, 1)[0];
    if (next) next.resolve(); else active--;
  }
  return {
    async read(input: Parameters<CanvasCardMediaPort['preview']>[0], purpose: CanvasPreviewReadPurpose) {
      await acquire(purpose);
      try {
        if (disposed) throw new DOMException('Canvas previews disposed', 'AbortError');
        return await preview(input);
      } finally { release(); }
    },
    dispose() {
      disposed = true;
      for (const request of waiting.splice(0)) request.reject(new DOMException('Canvas previews disposed', 'AbortError'));
    },
  };
}
