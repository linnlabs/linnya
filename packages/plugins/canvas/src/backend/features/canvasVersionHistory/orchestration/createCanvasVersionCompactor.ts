import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { CanvasVersionBudgetStatus } from '../definitions/canvasVersionHistory';
import type {
  CanvasVersionRuntimeDependencies,
  CanvasVersionHeadReader,
  CanvasVersionBudgetObserver,
} from '../definitions/canvasVersionRuntime';
import {
  validateCanvasVersionChain,
  reconstructCanvasVersion,
} from '../functions/reconstructCanvasVersions';
import { planCanvasVersionCompaction } from '../functions/planCanvasVersionCompaction';
/** 只为裁剪/预算维护重链，未受影响的载荷继续复用。 */
export function createCanvasVersionCompactor(
  options: CanvasVersionRuntimeDependencies &
    CanvasVersionHeadReader &
    Pick<CanvasVersionBudgetObserver, 'budgetStatus' | 'notifyBudget'>
) {
  const { repository, budgetBytes, requiredHead, budgetStatus, notifyBudget } = options;
  function compact(documentId: string): CanvasVersionBudgetStatus {
    const head = requiredHead(documentId),
      records = repository.readRecords(documentId);
    validateCanvasVersionChain(records, head);
    const readCurrent = () => {
      const snapshot = options.ports.readSnapshot(documentId);
      if (snapshot.sequence !== head.sequence) throw new DocumentHistoryError('version_conflict');
      return snapshot;
    };
    const readSnapshot = (versionId: string) =>
      reconstructCanvasVersion({ documentId, versionId, records, head, readCurrent });
    const protectedAssetIds = options.ports.protectedAssetIds(documentId),
      protectedAssets = new Set(protectedAssetIds);
    const historicalAssets = [...new Set(records.flatMap(record => record.assetIds))].filter(
      id => !protectedAssets.has(id)
    );
    const rows = repository.readSummaries(documentId, head);
    const plan = planCanvasVersionCompaction({
      rows,
      records,
      readSnapshot,
      headBytes: head.inverse?.byteLength ?? 0,
      budgetBytes,
      assetFacts: options.ports.assetByteFacts(documentId, historicalAssets),
      protectedAssetIds,
    });
    const original = new Map(records.map(record => [record.versionId, record]));
    options.database
      .transaction(() => {
        const live = requiredHead(documentId);
        if (live.sequence !== head.sequence || live.latestVersionId !== head.latestVersionId)
          throw new DocumentHistoryError('version_conflict');
        for (const record of plan.records)
          if (original.get(record.versionId) !== record) repository.writeRecord(documentId, record);
        if (plan.keepVersionIds.length !== records.length)
          repository.deleteExcept(documentId, plan.keepVersionIds);
        if (live.usedBytes !== plan.usedBytes || live.overBudgetBytes !== plan.overBudgetBytes) {
          repository.writeHead(documentId, {
            ...live,
            usedBytes: plan.usedBytes,
            overBudgetBytes: plan.overBudgetBytes,
          });
        }
        options.ports.reconcileHistoryAssets(documentId, [
          ...new Set(plan.records.flatMap(record => record.assetIds)),
        ]);
      })
      .immediate();
    const status = budgetStatus(documentId);
    notifyBudget(status);
    return status;
  }
  return compact;
}
