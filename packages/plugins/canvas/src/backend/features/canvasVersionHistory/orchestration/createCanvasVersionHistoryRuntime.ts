import type {
  CanvasVersionHistoryOptions,
  CanvasVersionBudgetStatus,
} from '../definitions/canvasVersionHistory';
import { createCanvasVersionRepository } from '../persistence/canvasVersionRepository';
import { createCanvasVersionMaintenance } from './createCanvasVersionMaintenance';
import { createCanvasVersionReads } from './createCanvasVersionReads';
import { createCanvasVersionCheckpoints } from './createCanvasVersionCheckpoints';
import { createCanvasVersionCompactor } from './createCanvasVersionCompactor';
import { createCanvasVersionCommitRecorder } from './createCanvasVersionCommitRecorder';
export type { CanvasCheckpointInput } from '../definitions/canvasVersionRuntime';
/** 组合读模型、恢复点、内容事务与维护；各流程不反向调用运行态。 */
export function createCanvasVersionHistoryRuntime(options: CanvasVersionHistoryOptions) {
  const repository = createCanvasVersionRepository(options.database);
  const dependencies = {
    ...options,
    repository,
    now: options.now ?? Date.now,
    budgetBytes: options.budgetBytes ?? 100 * 1024 * 1024,
  };
  const { requiredHead, ...queries } = createCanvasVersionReads(dependencies);
  const { initialize, checkpoint } = createCanvasVersionCheckpoints({
    ...dependencies,
    requiredHead,
  });
  const report = (documentId: string, error: unknown) =>
    options.ports.reportFailure(documentId, error);
  const notifyBudget = (status: CanvasVersionBudgetStatus) => {
    try {
      options.ports.budgetChanged?.(status);
    } catch (error) {
      report(status.documentId, error);
    }
  };
  const compact = createCanvasVersionCompactor({
    ...dependencies,
    requiredHead,
    budgetStatus: queries.budgetStatus,
    notifyBudget,
  });
  const maintenance = createCanvasVersionMaintenance({
    now: dependencies.now,
    readHead: repository.readHead,
    dirtyDocuments: repository.dirtyDocuments,
    checkpoint(documentId, reason) {
      checkpoint({ documentId, reason });
    },
    compact,
    reportFailure: report,
  });
  const recordCommit = createCanvasVersionCommitRecorder({
    ...dependencies,
    requiredHead,
    initialize,
    maintenance,
    report,
    notifyBudget,
    budgetStatus: queries.budgetStatus,
  });
  return {
    initialize,
    recordCommit,
    checkpoint,
    ...queries,
    compact,
    requestMaintenance: maintenance.requestMaintenance,
    close: maintenance.close,
    dispose: maintenance.dispose,
  };
}
