import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { DocumentVersionSummary } from '@app/schemas';
import type { CanvasSnapshot } from '../../../../shared';
import { collectCanvasAssetIds } from '../../canvasDocument';
import type { CanvasVersionRecord } from '../definitions/canvasVersionHistory';
import type {
  CanvasCheckpointInput,
  CanvasVersionRuntimeDependencies,
  CanvasVersionHeadReader,
} from '../definitions/canvasVersionRuntime';
import { planCanvasVersionCheckpoint } from '../functions/planCanvasVersionCheckpoint';
import {
  canvasVersionId,
  canvasVersionRecordBytes,
  summarizeCanvasVersion,
} from '../functions/canvasVersionIdentity';
import {
  canvasVersionHash,
  canvasVersionSnapshot,
  encodeCanvasVersion,
} from '../functions/canvasVersionCodec';
function initializeCanvasVersion(
  options: CanvasVersionRuntimeDependencies,
  documentId: string,
  timestamp: number,
  supplied?: CanvasSnapshot
): void {
  const { repository, budgetBytes } = options;
  options.database
    .transaction(() => {
      if (repository.readHead(documentId)) return;
      const snapshot = canvasVersionSnapshot(supplied ?? options.ports.readSnapshot(documentId));
      if (snapshot.documentId !== documentId) throw new DocumentHistoryError('version_conflict');
      const record: CanvasVersionRecord = {
        versionId: canvasVersionId(snapshot.sequence),
        sequence: snapshot.sequence,
        createdAt: timestamp,
        previousVersionId: null,
        hash: canvasVersionHash(snapshot),
        inverse: null,
        anchor: encodeCanvasVersion(snapshot),
        assetIds: collectCanvasAssetIds(snapshot.elements),
      };
      repository.writeRecord(documentId, record);
      const usedBytes = canvasVersionRecordBytes(record);
      repository.writeHead(documentId, {
        latestVersionId: record.versionId,
        sequence: record.sequence,
        changedAt: timestamp,
        dirtySince: null,
        inverse: null,
        bytesSinceAnchor: 0,
        usedBytes,
        overBudgetBytes: Math.max(0, usedBytes - budgetBytes),
      });
      options.ports.reconcileHistoryAssets(documentId, record.assetIds);
    })
    .immediate();
}
/** 初始化与建立恢复点共用同一事务，不改变开组前快照的准入顺序。 */
export function createCanvasVersionCheckpoints(
  options: CanvasVersionRuntimeDependencies & CanvasVersionHeadReader
) {
  const { repository, budgetBytes, now, requiredHead } = options;
  const initialize = (documentId: string, timestamp = now(), supplied?: CanvasSnapshot) =>
    initializeCanvasVersion(options, documentId, timestamp, supplied);
  function checkpoint(input: CanvasCheckpointInput): DocumentVersionSummary | null {
    return options.database
      .transaction(() => {
        const snapshot = canvasVersionSnapshot(
          input.snapshot ?? options.ports.readSnapshot(input.documentId)
        );
        initialize(input.documentId, input.now ?? now(), snapshot);
        const head = requiredHead(input.documentId);
        if (snapshot.documentId !== input.documentId || head.sequence !== snapshot.sequence)
          throw new DocumentHistoryError('version_conflict');
        if (
          input.reason === 'migration' &&
          head.latestVersionId === canvasVersionId(head.sequence)
        ) {
          const record = repository
            .readRecords(input.documentId)
            .find(row => row.versionId === head.latestVersionId);
          if (!record || canvasVersionHash(snapshot) !== record.hash)
            throw new DocumentHistoryError('version_corrupt');
          if (!record.anchor) {
            const anchor = encodeCanvasVersion(snapshot),
              usedBytes = head.usedBytes + anchor.byteLength;
            repository.writeRecord(input.documentId, { ...record, anchor });
            repository.writeHead(input.documentId, {
              ...head,
              bytesSinceAnchor: 0,
              usedBytes,
              overBudgetBytes: Math.max(0, usedBytes - budgetBytes),
            });
          }
          return summarizeCanvasVersion(record, true);
        }
        if ((head.dirtySince === null || !head.inverse) && input.reason !== 'migration')
          return null;
        const planned = planCanvasVersionCheckpoint({
          head,
          snapshot,
          budgetBytes,
          migration: input.reason === 'migration',
          restoredFrom: input.restoredFrom,
        });
        repository.writeRecord(input.documentId, planned.record);
        repository.writeHead(input.documentId, planned.head);
        options.ports.reconcileHistoryAssets(
          input.documentId,
          repository.retainedAssetIds(input.documentId)
        );
        return summarizeCanvasVersion(planned.record, true);
      })
      .immediate();
  }
  return { initialize, checkpoint };
}
