import { saveWorkspaceNodeTextSnapshot, Logger } from '@plugin/backend/workspaceRuntime';
import { CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE } from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { readCanvasSnapshot } from '../features/canvasCommit';
import { readCanvasProjectionContext } from '../features/canvasDocument';
import { projectCanvasSearchText } from '../features/canvasProjection';

/** 文本索引与版本检查点有独立节奏，持续输入不能延后第一批脏内容的30秒截止。 */
export function createCanvasTextSnapshots(database: CanvasDatabase) {
  const pending = new Set<string>(); const logger = new Logger('CanvasSearchSnapshot');
  let timer: ReturnType<typeof setTimeout> | null = null;
  function refresh(documentId: string) {
    const snapshot = readCanvasSnapshot(database, documentId);
    saveWorkspaceNodeTextSnapshot({ db: database, nodeId: documentId, contentType: 'text/plain',
      text: projectCanvasSearchText(snapshot, readCanvasProjectionContext(database, snapshot)), sourcePluginId: CANVAS_PLUGIN_ID, sourceNodeType: CANVAS_DOCUMENT_TYPE });
    pending.delete(documentId);
  }
  function flush() {
    if (timer) clearTimeout(timer); timer = null;
    for (const documentId of [...pending]) {
      try { refresh(documentId); } catch (error) { logger.error('Canvas文本快照刷新失败', { documentId, error }); }
    }
  }
  function schedule(documentId: string) { pending.add(documentId); if (!timer) timer = setTimeout(flush, 30000); }
  return { refresh, flush, schedule };
}
