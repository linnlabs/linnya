import type { BackendPluginRendererContext } from '@plugin/backend/pluginIpcRuntime';

interface CanvasView {
  readonly documentId: string;
  readonly sessionId: string | null;
}
interface RendererSession {
  readonly signal: AbortSignal;
  readonly release: () => void;
  readonly views: Set<string>;
}

/** 视图属于一次 Renderer 加载；关闭页签与窗口崩溃共享同一条释放路径。 */
export function createCanvasViewLifecycle(input: {
  readonly closed: (documentId: string, viewId: string, lastView: boolean) => void;
  readonly failed: (error: unknown, documentId: string) => void;
}) {
  const views = new Map<string, CanvasView>();
  const sessions = new Map<string, RendererSession>();
  function close(documentId: string, viewId: string): void {
    const view = views.get(viewId);
    if (view?.documentId !== documentId) return;
    views.delete(viewId);
    if (view.sessionId) {
      const session = sessions.get(view.sessionId);
      session?.views.delete(viewId);
      if (session && session.views.size === 0) {
        session.signal.removeEventListener('abort', session.release);
        sessions.delete(view.sessionId);
      }
    }
    input.closed(
      documentId,
      viewId,
      ![...views.values()].some(view => view.documentId === documentId)
    );
  }
  function register(
    documentId: string,
    viewId: string,
    context?: BackendPluginRendererContext
  ): void {
    context?.signal.throwIfAborted();
    const previous = views.get(viewId);
    if (
      previous &&
      (previous.documentId !== documentId ||
        previous.sessionId !== (context?.rendererSessionId ?? null))
    ) {
      throw new Error('canvas_view_identity_mismatch');
    }
    views.set(viewId, { documentId, sessionId: context?.rendererSessionId ?? null });
    if (!context) return;
    let session = sessions.get(context.rendererSessionId);
    if (!session) {
      const release = () => {
        for (const id of [...(sessions.get(context.rendererSessionId)?.views ?? [])]) {
          const view = views.get(id);
          if (view)
            try {
              close(view.documentId, id);
            } catch (error) {
              input.failed(error, view.documentId);
            }
        }
      };
      session = { signal: context.signal, release, views: new Set() };
      sessions.set(context.rendererSessionId, session);
      context.signal.addEventListener('abort', release, { once: true });
    }
    session.views.add(viewId);
  }
  function dispose(): void {
    for (const [id, view] of [...views]) {
      try {
        close(view.documentId, id);
      } catch (error) {
        input.failed(error, view.documentId);
      }
    }
  }
  return {
    register,
    close,
    dispose,
    has: (documentId: string, viewId: string) => views.get(viewId)?.documentId === documentId,
  };
}
