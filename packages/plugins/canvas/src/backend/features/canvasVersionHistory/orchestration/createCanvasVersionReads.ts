import { z } from 'zod';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { DocumentVersionRestoreRequest, DocumentVersionSummary } from '@app/schemas';
import type { CanvasSnapshot } from '../../../../shared';
import type { CanvasVersionBudgetStatus } from '../definitions/canvasVersionHistory';
import type { CanvasVersionRuntimeDependencies } from '../definitions/canvasVersionRuntime';
import { canvasVersionId } from '../functions/canvasVersionIdentity';
import { canvasVersionSnapshot } from '../functions/canvasVersionCodec';
import { reconstructCanvasVersion } from '../functions/reconstructCanvasVersions';
/** 只读当前元数据与按需反放；不创建恢复点或触发维护。 */
export function createCanvasVersionReads(options: CanvasVersionRuntimeDependencies) {
  const { repository, budgetBytes } = options;
  function requiredHead(documentId: string) {
    const head = repository.readHead(documentId);
    if (!head) throw new DocumentHistoryError('history_unavailable');
    return head;
  }
  function list(documentId: string): DocumentVersionSummary[] {
    const head = repository.readHead(documentId);
    return head ? repository.readSummaries(documentId, head) : [];
  }
  function retainedAssetIds(documentId: string): readonly string[] {
    return repository.retainedAssetIds(documentId);
  }
  function budgetStatus(documentId: string): CanvasVersionBudgetStatus {
    const head = requiredHead(documentId);
    return {
      documentId,
      usedBytes: head.usedBytes,
      budgetBytes,
      overBudgetBytes: head.overBudgetBytes,
    };
  }
  function assertCurrent(
    request: Pick<DocumentVersionRestoreRequest, 'documentId' | 'expectedCurrentVersionId'>
  ): void {
    if (
      canvasVersionId(requiredHead(request.documentId).sequence) !==
      request.expectedCurrentVersionId
    )
      throw new DocumentHistoryError('version_conflict');
  }
  function preview(documentId: string, versionId: string): CanvasSnapshot {
    const head = requiredHead(documentId);
    const readCurrent = () => {
      const current = options.ports.readSnapshot(documentId);
      if (current.sequence !== head.sequence) throw new DocumentHistoryError('version_conflict');
      return current;
    };
    if (versionId === canvasVersionId(head.sequence)) return canvasVersionSnapshot(readCurrent());
    try {
      return reconstructCanvasVersion({
        documentId,
        versionId,
        records: repository.readRecords(documentId),
        head,
        readCurrent,
      });
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new DocumentHistoryError('version_corrupt', { cause: error });
      throw error;
    }
  }
  function prepareRestore(request: DocumentVersionRestoreRequest) {
    assertCurrent(request);
    const target = list(request.documentId).find(row => row.versionId === request.versionId);
    if (!target) throw new DocumentHistoryError('version_not_found');
    return { snapshot: preview(request.documentId, request.versionId), target };
  }
  return {
    requiredHead,
    list,
    retainedAssetIds,
    budgetStatus,
    assertCurrent,
    preview,
    prepareRestore,
  };
}
