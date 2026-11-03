import { encodeCanvasHistorySession } from '@plugin/canvas/shared';
const views = new Map<string, { readonly viewId: string; readonly capture: () => string }>();

/** 当前Renderer窗口内的表面身份；历史面板打开时冻结它，后台不猜测另一个窗口。 */
export function registerCanvasHistorySession(documentId: string, viewId: string, capture: () => string): () => void {
  const entry = { viewId, capture }; views.set(documentId, entry);
  return () => { if (views.get(documentId) === entry) views.delete(documentId); };
}
export function readCanvasHistorySession(documentId: string): string | null {
  const entry = views.get(documentId); return entry ? encodeCanvasHistorySession(entry.viewId, entry.capture()) : null;
}
