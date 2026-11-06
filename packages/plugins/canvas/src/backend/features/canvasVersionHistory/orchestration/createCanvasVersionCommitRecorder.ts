import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { CanvasSnapshot } from '../../../../shared';
import type { CanvasHistoryCommitInput } from '../../canvasCommit';
import type {
  CanvasVersionRuntimeDependencies,
  CanvasVersionHeadReader,
  CanvasVersionBudgetObserver,
} from '../definitions/canvasVersionRuntime';
import type { createCanvasVersionCheckpoints } from './createCanvasVersionCheckpoints';
import type { createCanvasVersionMaintenance } from './createCanvasVersionMaintenance';
import { canvasVersionId } from '../functions/canvasVersionIdentity';
import {
  decodeCanvasVersionInverse,
  encodeCanvasVersion,
  mergeCanvasVersionHead,
} from '../functions/canvasVersionCodec';
/** 内容事务保存逆增量；通知和timer仍由返回的afterCommit执行。 */
export function createCanvasVersionCommitRecorder(
  options: CanvasVersionRuntimeDependencies &
    CanvasVersionHeadReader &
    CanvasVersionBudgetObserver & {
      readonly initialize: ReturnType<typeof createCanvasVersionCheckpoints>['initialize'];
      readonly maintenance: ReturnType<typeof createCanvasVersionMaintenance>;
    }
) {
  const {
    repository,
    budgetBytes,
    requiredHead,
    initialize,
    maintenance,
    report,
    notifyBudget,
    budgetStatus,
  } = options;
  function recordCommit(history: CanvasHistoryCommitInput): (() => void) | undefined {
    if (!history.plan.changes.length) return undefined;
    const documentId = history.context.documentId;
    const before = {
      schemaVersion: 1,
      documentId,
      sequence: history.before.sequence,
      elements: history.before.elements.map(row => row.element),
    } satisfies CanvasSnapshot;
    initialize(documentId, history.context.now, before);
    const head = requiredHead(documentId);
    if (head.sequence !== history.before.sequence)
      throw new DocumentHistoryError('version_conflict');
    const inverse = mergeCanvasVersionHead(
      decodeCanvasVersionInverse(head.inverse),
      history.plan.changes
    );
    const encoded = inverse.length ? encodeCanvasVersion(inverse) : null;
    const usedBytes = head.usedBytes + (encoded?.byteLength ?? 0) - (head.inverse?.byteLength ?? 0);
    repository.writeHead(documentId, {
      ...head,
      sequence: history.plan.state.sequence,
      changedAt: history.context.now,
      dirtySince: inverse.length ? (head.dirtySince ?? history.context.now) : null,
      inverse: encoded,
      usedBytes,
      overBudgetBytes: Math.max(0, usedBytes - budgetBytes),
    });
    return () => {
      // 通知和计时失败发生在正式提交以后，只报告；不能把已保存内容说成保存失败。
      try {
        maintenance.schedule(documentId);
        const current = requiredHead(documentId);
        // 新恢复点或载荷超预算才安排整理，不能为每个普通Agent增量反放历史。
        if (
          head.latestVersionId === canvasVersionId(history.before.sequence) ||
          current.latestVersionId !== head.latestVersionId ||
          current.overBudgetBytes > 0
        )
          maintenance.requestMaintenance(documentId);
        notifyBudget(budgetStatus(documentId));
      } catch (error) {
        report(documentId, error);
      }
    };
  }
  return recordCommit;
}
