import { publishWorkspaceDocumentUpdated, type Logger } from '@plugin/backend/workspaceRuntime';
import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import { CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, CANVAS_DOCUMENT_TYPE } from '../../shared';
import { readCanvasDocumentIdentity } from '../features/canvasDocument';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import type { CanvasCommitPorts } from '../features/canvasCommit';
/** 事务结束后的内容通知与搜索调度不参与已完成提交的成败。 */
export function createCanvasDocumentPublications(
  database: CanvasDatabase,
  scheduleTextSnapshot: (documentId: string) => void,
  logger: Pick<Logger, 'error'>
): Pick<CanvasCommitPorts, 'publish' | 'publicationFailed'> {
  return {
    publish(plan, context, publication) {
      const node = readCanvasDocumentIdentity(database, context.documentId);
      scheduleTextSnapshot(context.documentId);
      broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, {
        documentId: context.documentId,
        sequence: plan.state.sequence,
        committedAt: publication.committedAt,
        sourceKind: context.actor.source.kind,
        changedElementCount: new Set(plan.changes.map(change => change.id)).size,
      });
      publishWorkspaceDocumentUpdated({
        documentId: context.documentId,
        projectId: node.projectId,
        nodeType: CANVAS_DOCUMENT_TYPE,
        mutationKind: 'incremental',
        versionNumber: plan.state.sequence,
      });
    },
    publicationFailed(error) {
      logger.error('Canvas 已提交，后续通知失败；客户端须按序号补拉', { error });
    },
  };
}
