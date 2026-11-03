import { listDocumentAssetByteFacts, reconcileDocumentAssetOwnership } from '@plugin/backend/documentAssetOwnership';
import { Logger } from '@plugin/backend/workspaceRuntime';
import type { CanvasElement, CanvasSnapshot, CanvasVersionBudgetStatus } from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { readCanvasCommitState } from '../features/canvasCommit';
import { collectCanvasAssetIds, collectCanvasCommandAssetIds } from '../features/canvasDocument';
import { readCanvasPendingBatches } from '../features/agentChanges';
import type { CanvasVersionHistoryPorts } from '../features/canvasVersionHistory';

export function createCanvasVersionHistoryPorts(input: { readonly database: CanvasDatabase; readonly retainedElements: (documentId: string) => readonly CanvasElement[];
  readonly budgetChanged: (status: CanvasVersionBudgetStatus) => void }) {
  const logger = new Logger('CanvasVersions');
  function readSnapshot(documentId: string): CanvasSnapshot {
    const state = readCanvasCommitState(input.database, documentId);
    return { schemaVersion: 1, documentId, sequence: state.sequence, elements: state.elements.map(row => row.element) };
  }
  function pendingAssetIds(documentId: string) { return [...new Set(readCanvasPendingBatches(input.database, documentId).flatMap(batch => collectCanvasCommandAssetIds(batch.request.operations)))]; }
  function protectedAssetIds(documentId: string) {
    return [...new Set([...collectCanvasAssetIds([...readSnapshot(documentId).elements, ...input.retainedElements(documentId)]), ...pendingAssetIds(documentId)])];
  }
  const ports: CanvasVersionHistoryPorts = {
    readSnapshot, protectedAssetIds, budgetChanged: input.budgetChanged,
    assetByteFacts: (documentId, assetIds) => listDocumentAssetByteFacts({ database: input.database, documentId, assetIds }),
    reconcileHistoryAssets(documentId, historicalAssetIds) {
      reconcileDocumentAssetOwnership({ database: input.database, documentId,
        assetIds: [...new Set([...historicalAssetIds, ...protectedAssetIds(documentId)])], usageHint: 'canvas:reachable' });
    },
    reportFailure(documentId, error) { logger.error('Canvas历史维护失败，已保存内容与现有历史保持', { documentId, error }); },
  };
  return { ports, pendingAssetIds, readSnapshot };
}
