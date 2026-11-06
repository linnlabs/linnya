import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { CanvasVersionBudgetStatus } from '../definitions/canvasVersionHistory';
import type {
  CanvasVersionRuntimeDependencies,
  CanvasVersionHeadReader,
  CanvasVersionBudgetObserver,
} from '../definitions/canvasVersionRuntime';
import {
  readCanvasVersionChain,
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
      stored = repository.readRecords(documentId),
      records = readCanvasVersionChain(stored, head),
      chainIds = new Set(records.map(record => record.versionId));
    // 链本身必须完整有效；只有这时链外残留才可安全删除，其余损坏照旧报错。
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
    const rows = repository
      .readSummaries(documentId, head)
      .filter(row => row.isCurrent || chainIds.has(row.versionId));
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
        // 保留列表可能含未封存的“当前”行，不能按条数判断；任一已封存记录不在保留集即须删除，
        // 否则后继已重链跳过它，留下断链。
        const keep = new Set(plan.keepVersionIds);
        if (stored.some(record => !keep.has(record.versionId)))
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
