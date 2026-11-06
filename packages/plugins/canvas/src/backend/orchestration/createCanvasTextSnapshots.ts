import { CANVAS_TEXT_SNAPSHOT_INTERVAL_MS } from '../definitions/canvasProjectionLimits';
import { saveWorkspaceNodeTextSnapshot, Logger } from '@plugin/backend/workspaceRuntime';
import { CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE } from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { readCanvasSnapshot } from '../features/canvasCommit';
import { readCanvasProjectionContext } from '../features/canvasDocument';
import { projectCanvasSearchText } from '../features/canvasProjection';
import { readWorkspaceDocumentIdentity } from '@plugin/backend/workspaceDocumentProjection';

/** 文本索引与版本检查点有独立节奏，持续输入不能延后第一批脏内容的30秒截止。 */
export function createCanvasTextSnapshots(database: CanvasDatabase) {
  const pending = new Set<string>(); const logger = new Logger('CanvasSearchSnapshot');
  let timer: ReturnType<typeof setTimeout> | null = null;
  function refresh(documentId: string) {
    const document = readWorkspaceDocumentIdentity(database, documentId);
    // 正常关闭或删除文档时不再生成搜索投影；没有内容不能被当成格式损坏。
    if (!document || document.deletedAt !== null) { pending.delete(documentId); return; }
    const snapshot = readCanvasSnapshot(database, documentId);
    if (snapshot.integrity) {
      pending.delete(documentId);
      logger.warn('Canvas只读隔离保留此前可读文本快照', { documentId, issueCount: snapshot.integrity.issues.length });
      return;
    }
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
  function schedule(documentId: string) {
    pending.add(documentId);
    if (!timer) { timer = setTimeout(flush, CANVAS_TEXT_SNAPSHOT_INTERVAL_MS); timer.unref(); }
  }
  return { refresh, flush, schedule };
}
