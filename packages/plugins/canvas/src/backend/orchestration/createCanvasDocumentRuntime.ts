import { Logger } from '@plugin/backend/workspaceRuntime';
import { createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { CanvasDocumentFailure, createCanvasViewLifecycle } from '../features/canvasDocument';
import { createCanvasTextSnapshots } from './createCanvasTextSnapshots';
import { createCanvasDocumentQueries } from './createCanvasDocumentQueries';
import { createCanvasDocumentWrites } from './createCanvasDocumentWrites';
import { createCanvasDocumentHistory } from './createCanvasDocumentHistory';
export function createCanvasDocumentRuntime(
  database: CanvasDatabase,
  references = createDocumentReferenceMarkdownRuntime(database)
) {
  const logger = new Logger('Canvas');

  const textSnapshots = createCanvasTextSnapshots(database);
  const viewClosed = new Set<(documentId: string, viewId: string) => void>();
  const views = createCanvasViewLifecycle({
    closed(documentId, viewId, lastView) {
      for (const listener of viewClosed) listener(documentId, viewId);
      editing.releaseView(viewId);
      if (active && lastView) {
        textSnapshots.refresh(documentId);
        versions.close(documentId);
      }
    },
    failed(error, documentId) {
      logger.error('释放 Canvas 视图失败', { documentId, error });
    },
  });
  let active = true;
  const assertActive = () => {
    if (!active)
      throw new CanvasDocumentFailure('runtime_closed', '画布运行态已停用，请重新打开后重试');
  };

  const { editing, versions, history, pendingAssetIds, stopNotifications } =
    createCanvasDocumentHistory({
      database,
      references,
      assertActive,
      hasView: (documentId, viewId) => active && views.has(documentId, viewId),
      scheduleTextSnapshot: textSnapshots.schedule,
    });
  function close(documentId: string, viewId: string) {
    views.close(documentId, viewId);
  }
  function dispose() {
    if (!active) return;
    active = false;
    stopNotifications();
    textSnapshots.flush();
    views.dispose();
    viewClosed.clear();
    versions.dispose();
  }
  const dependencies = { database, assertActive, views, editing, versions, textSnapshots };
  const queries = createCanvasDocumentQueries(dependencies),
    writes = createCanvasDocumentWrites(dependencies);
  return {
    ...queries,
    ...writes,
    close,
    dispose,
    onViewClosed(listener: (documentId: string, viewId: string) => void) {
      viewClosed.add(listener);
      return () => viewClosed.delete(listener);
    },
    refreshTextSnapshot: textSnapshots.refresh,
    editing,
    references,
    versions,
    history,
    pendingAssetIds,
  };
}
export type CanvasDocumentRuntime = ReturnType<typeof createCanvasDocumentRuntime>;
