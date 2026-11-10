import type {
  CanvasHistoryViewBaseline,
  CanvasUserHistoryScope,
} from '../definitions/canvasUserHistoryState';

/** 每个Backend实例的用户栈；只持有同步状态，合并、裁剪和撤销规则由functions计算。 */
export function createCanvasUserHistoryState() {
  const scopes = new Map<string, CanvasUserHistoryScope>();
  const views = new Map<string, CanvasHistoryViewBaseline>();
  const key = (documentId: string, viewId: string) => JSON.stringify([documentId, viewId]);
  return {
    read(documentId: string, viewId: string): CanvasUserHistoryScope {
      return scopes.get(key(documentId, viewId)) ?? { documentId, viewId, undo: [], redo: [] };
    },
    install(scope: CanvasUserHistoryScope) {
      scopes.set(key(scope.documentId, scope.viewId), scope);
    },
    list(documentId: string) {
      return [...scopes.values()].filter(scope => scope.documentId === documentId);
    },
    registerView(view: CanvasHistoryViewBaseline) {
      const identity = key(view.documentId, view.viewId);
      if (!views.has(identity)) views.set(identity, view);
    },
    viewBaseline(documentId: string, viewId: string) {
      return views.get(key(documentId, viewId))?.sequence;
    },
    baselines(documentId: string) {
      return [...views.values()]
        .filter(view => view.documentId === documentId)
        .map(view => view.sequence);
    },
    releaseView(viewId: string) {
      const documents = new Set<string>();
      for (const [identity, view] of views) if (view.viewId === viewId) views.delete(identity);
      for (const [identity, scope] of scopes)
        if (scope.viewId === viewId) {
          documents.add(scope.documentId);
          scopes.delete(identity);
        }
      return [...documents];
    },
  };
}
