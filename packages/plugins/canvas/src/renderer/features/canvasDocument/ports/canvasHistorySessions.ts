const views = new Map<string, string>();

/** 当前Renderer窗口内的表面身份；历史面板打开时冻结它，后台不猜测另一个窗口。 */
export function registerCanvasHistorySession(documentId: string, viewId: string): () => void {
  views.set(documentId, viewId);
  return () => { if (views.get(documentId) === viewId) views.delete(documentId); };
}
export function readCanvasHistorySession(documentId: string): string | null { return views.get(documentId) ?? null; }
