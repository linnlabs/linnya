import { encodeCanvasHistorySession } from '@plugin/canvas/shared';
const views = new Map<
  string,
  Map<string, { readonly viewId: string; readonly capture: () => string }>
>();

/** 当前Renderer窗口内的表面身份；历史面板打开时冻结它，后台不猜测另一个窗口。 */
export function registerCanvasHistorySession(
  documentId: string,
  viewId: string,
  capture: () => string
): () => void {
  const entry = { viewId, capture },
    documentViews = views.get(documentId) ?? new Map<string, typeof entry>();
  documentViews.set(viewId, entry);
  views.set(documentId, documentViews);
  return () => {
    if (documentViews.get(viewId) === entry) documentViews.delete(viewId);
    if (!documentViews.size && views.get(documentId) === documentViews) views.delete(documentId);
  };
}
export function readCanvasHistorySession(documentId: string): string | null {
  // Host 文档动作没有 view 参数：选择最近注册且仍存活的表面，销毁后恢复前一个。
  const entries = [...(views.get(documentId)?.values() ?? [])],
    entry = entries[entries.length - 1];
  return entry ? encodeCanvasHistorySession(entry.viewId, entry.capture()) : null;
}
