import { touchWorkspaceDocument } from '@plugin/backend/workspaceDocumentProjection';
import {
  replaceDocumentReferences,
  type DocumentReferenceMarkdownRuntime,
} from '@plugin/backend/documentReferences';
import { registerDocumentAssetOwnership } from '@plugin/backend/documentAssetOwnership';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import type { CanvasCommitParticipant } from '../features/canvasCommit';
import type { CanvasPendingBatch } from '../features/agentChanges';
import {
  readCanvasChangedResources,
  collectCanvasCommandAssetIds,
  collectCanvasReferences,
  readCanvasDocumentIdentity,
} from '../features/canvasDocument';

/** Host关系和资源归属参加当前Canvas事务，身份与路径不在异步准备时提前承诺。 */
export function createCanvasDocumentCommitParticipants(
  database: CanvasDatabase,
  references: DocumentReferenceMarkdownRuntime
) {
  const participant: CanvasCommitParticipant = {
    commit(plan, context) {
      readCanvasDocumentIdentity(database, context.documentId, context.actor.projectId);
      references.assertBindings({
        sourceDocumentId: context.documentId,
        bindings: context.referenceBindings ?? [],
      });
      touchWorkspaceDocument(database, context.documentId, context.now);
      const resources = readCanvasChangedResources(plan.changes);
      if (resources.referencesChanged) {
        const retainedReferences = collectCanvasReferences(plan.retainedElements ?? []).map(
          reference => ({
            referenceId: reference.referenceId,
            targetDocumentId: reference.targetDocumentId,
          })
        );
        replaceDocumentReferences(
          database,
          {
            sourceDocumentId: context.documentId,
            references: collectCanvasReferences(plan.state.elements.map(row => row.element)),
          },
          { retainedReferences }
        );
      }
      if (resources.addedAssetIds.length)
        registerDocumentAssetOwnership({
          database,
          documentId: context.documentId,
          assetIds: resources.addedAssetIds,
          usageHint: 'canvas:content',
        });
    },
  };
  function pendingApproval(batch: CanvasPendingBatch) {
    readCanvasDocumentIdentity(database, batch.request.documentId, batch.actor.projectId);
    references.assertBindings({
      sourceDocumentId: batch.request.documentId,
      bindings: batch.request.referenceBindings ?? [],
    });
    const assets = collectCanvasCommandAssetIds(batch.request.operations);
    if (assets.length)
      registerDocumentAssetOwnership({
        database,
        documentId: batch.request.documentId,
        assetIds: assets,
        usageHint: 'canvas:pending-approval',
      });
  }
  return { participants: [participant], pendingApproval };
}
