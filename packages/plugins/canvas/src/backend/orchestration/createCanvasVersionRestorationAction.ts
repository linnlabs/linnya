import { createHash } from 'node:crypto';
import { DocumentVersionRestoreRequestSchema, type DocumentVersionSummary } from '@app/schemas';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import { createDocumentImageAssetRuntime } from '@plugin/backend/documentImageAsset';
import {
  canvasSourceKey,
  readCanvasReceipt,
  type CanvasCommitActor,
} from '../features/canvasCommit';
import { collectCanvasAssetIds, readCanvasDocumentIdentity } from '../features/canvasDocument';
import { planCanvasVersionRestoration } from '../features/canvasVersionRestore';
import { decodeCanvasHistorySession } from '../../shared';
import type { CanvasVersionRestorationActionOptions } from '../definitions/canvasVersionActions';
/** 恢复流程独占异步资产准入和最终事务复核，查询入口不承担这些副作用。 */
export function createCanvasVersionRestorationAction(input: CanvasVersionRestorationActionOptions) {
  const { list } = input;
  async function restore(value: unknown): Promise<DocumentVersionSummary> {
    const request = DocumentVersionRestoreRequestSchema.parse(value);
    const clientSessionId = request.clientSessionId;
    const session = clientSessionId ? decodeCanvasHistorySession(clientSessionId) : null;
    if (!clientSessionId || !session || !input.hasView(request.documentId, session.viewId))
      throw new DocumentHistoryError('history_unavailable');
    readCanvasDocumentIdentity(input.database, request.documentId);
    input.versions.initialize(request.documentId);
    const actor: CanvasCommitActor = {
      viewId: session.viewId,
      source: { kind: 'user', conversationId: null, runId: null },
    };
    const requestId =
      'version-restore:' + createHash('sha256').update(JSON.stringify(request)).digest('hex');
    // 重复确认只接纳已提交事实；不得在后来Agent又修改后重放旧恢复。
    const replay = readCanvasReceipt(input.database, {
      documentId: request.documentId,
      requestId,
      sourceKey: canvasSourceKey(actor),
    });
    if (replay) {
      // 首次回包或推送可能丢失；重复确认补发捕获身份，让对应草稿完成同步，内容不重做。
      input.restored({
        documentId: request.documentId,
        clientSessionId,
        sequence: replay.result.sequence,
      });
      return list(request.documentId)[0];
    }
    const prepared = input.versions.prepareRestore(request);
    const images = createDocumentImageAssetRuntime(input.database);
    for (const assetId of collectCanvasAssetIds(prepared.snapshot.elements))
      await images.readOwnedImage({ documentId: request.documentId, assetId });
    let currentSummary = prepared.target;
    const commit = input.editing.transition({
      documentId: request.documentId,
      requestId,
      actor,
      now: Date.now(),
      payload: { kind: 'version-restore', ...request },
      buildPlan(state, claims, origin) {
        readCanvasDocumentIdentity(input.database, request.documentId);
        if (!input.hasView(request.documentId, session.viewId))
          throw new DocumentHistoryError('history_unavailable');
        // 图片读取期间视图可能关闭、历史可能裁剪；事务内重新验证正式目标。
        const currentTarget = input.versions.prepareRestore(request);
        currentSummary = input.versions.list(request.documentId)[0];
        return planCanvasVersionRestoration({
          state,
          targetSnapshot: currentTarget.snapshot,
          actor,
          claims,
          origin,
          now: Date.now(),
        });
      },
      beforeHistory(history) {
        if (!history.plan.changes.length) return;
        input.versions.checkpoint({
          documentId: request.documentId,
          reason: 'restore',
          now: history.context.now,
          snapshot: {
            schemaVersion: 1,
            documentId: request.documentId,
            sequence: history.before.sequence,
            elements: history.before.elements.map(row => row.element),
          },
        });
      },
      onCommit(history) {
        if (!history.plan.changes.length) return;
        const checkpoint = input.versions.checkpoint({
          documentId: request.documentId,
          reason: 'restore',
          now: history.context.now,
          snapshot: {
            schemaVersion: 1,
            documentId: request.documentId,
            sequence: history.plan.state.sequence,
            elements: history.plan.state.elements.map(row => row.element),
          },
          restoredFrom: {
            versionId: prepared.target.versionId,
            createdAt: prepared.target.createdAt,
          },
        });
        if (checkpoint) currentSummary = checkpoint;
      },
    });
    input.restored({ documentId: request.documentId, clientSessionId, sequence: commit.sequence });
    return currentSummary;
  }
  return restore;
}
