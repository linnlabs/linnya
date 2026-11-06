import type { CanvasDocumentPort } from '../definitions/canvasDocumentSession';
import type { CanvasSnapshot } from '@plugin/canvas/shared';

/** 同一表面复用viewId；RPC生命周期必须有序，迟到close不能释放下一次打开的视图。 */
export function createCanvasViewRequests(options: {
  readonly port: Pick<CanvasDocumentPort, 'read' | 'close'>;
  readonly viewId: string;
  readonly flushClaims: () => Promise<void>;
}) {
  let currentDocument: string | null = null;
  let pending = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = pending.then(operation);
    pending = run.then(() => undefined, () => undefined);
    return run;
  }
  async function closeCurrent(): Promise<void> {
    if (currentDocument === null) return;
    const documentId = currentDocument;
    await options.flushClaims();
    await options.port.close(documentId, options.viewId);
    currentDocument = null;
  }
  return {
    open(documentId: string, current: () => boolean) {
      return enqueue(async () => {
        if (!current()) return null;
        await closeCurrent();
        if (!current()) return null;
        currentDocument = documentId;
        let snapshot: CanvasSnapshot;
        try {
          snapshot = await options.port.read(documentId, options.viewId);
          if (snapshot.documentId !== documentId) throw new Error('Canvas open response belongs to another document');
        } catch (error) {
          await closeCurrent();
          throw error;
        }
        if (!current()) { await closeCurrent(); return null; }
        return snapshot;
      });
    },
    close: () => enqueue(closeCurrent),
  };
}
