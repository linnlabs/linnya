import { createCanvasGroupNotifications } from '../features/agentChanges';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import {
  CANVAS_PLUGIN_ID,
  CANVAS_GROUPS_CHANGED_CHANNEL,
  CANVAS_HISTORY_BUDGET_CHANNEL,
  CANVAS_RESTORED_CHANNEL,
} from '../../shared';
import { createCanvasHistoryRuntime } from './history/createCanvasHistoryRuntime';
import { createCanvasVersionHistoryRuntime } from '../features/canvasVersionHistory';
import { createCanvasVersionHistoryPorts } from '../adapters/createCanvasVersionHistoryPorts';
import { createCanvasVersionActions } from './createCanvasVersionActions';
import { createCanvasDocumentCommitParticipants } from '../adapters/createCanvasDocumentCommitParticipants';
import { createCanvasDocumentPublications } from '../adapters/createCanvasDocumentPublications';
import type { CanvasDocumentHistoryOptions } from '../definitions/canvasDocumentHistory';
/** 同一数据库中的会话撤销、Agent组、版本与资产持有者在组合层接线。 */
export function createCanvasDocumentHistory(options: CanvasDocumentHistoryOptions) {
  const { database, references, assertActive } = options;
  const logger = new Logger('Canvas');
  const groupNotifications = createCanvasGroupNotifications({
    publish: documentId =>
      broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_GROUPS_CHANGED_CHANNEL, {
        documentId,
      }),
    failed(error, documentId) {
      logger.error('Canvas 写入静默通知失败', { documentId, error });
    },
  });
  const versionPorts = createCanvasVersionHistoryPorts({
    database,
    retainedElements: documentId => editing.retainedElements(documentId),
    budgetChanged: status =>
      broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_HISTORY_BUDGET_CHANNEL, status),
  });
  const versions = createCanvasVersionHistoryRuntime({ database, ports: versionPorts.ports });
  const admission = createCanvasDocumentCommitParticipants(database, references);
  const editing: ReturnType<typeof createCanvasHistoryRuntime> = createCanvasHistoryRuntime({
    database,
    pendingApproval(batch) {
      assertActive();
      admission.pendingApproval(batch);
    },
    groupStarted({ documentId, before, now }) {
      versions.checkpoint({
        documentId,
        reason: 'agent-group',
        now,
        snapshot: {
          schemaVersion: 1,
          documentId,
          sequence: before.sequence,
          elements: before.elements.map(row => row.element),
        },
      });
    },
    groupsChanged(documentId, reason) {
      if (reason === 'release') versions.requestMaintenance(documentId);
      groupNotifications.changed(documentId, reason);
    },
    ports: {
      // CLI 的正文/图片准入可跨过停用时刻；最终事务统一拒绝旧运行态，不能只检查入口。
      participants: [
        {
          commit() {
            assertActive();
          },
        },
        ...admission.participants,
      ],
      history: versions.recordCommit,
      ...createCanvasDocumentPublications(database, options.scheduleTextSnapshot, logger),
    },
  });
  const history = createCanvasVersionActions({
    database,
    versions,
    editing,
    hasView: options.hasView,
    restored(event) {
      try {
        broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_RESTORED_CHANNEL, event);
      } catch (error) {
        logger.error('Canvas版本已恢复，恢复通知失败', { error, documentId: event.documentId });
      }
    },
  });
  return {
    editing,
    versions,
    history,
    pendingAssetIds: versionPorts.pendingAssetIds,
    stopNotifications: groupNotifications.dispose,
  };
}
