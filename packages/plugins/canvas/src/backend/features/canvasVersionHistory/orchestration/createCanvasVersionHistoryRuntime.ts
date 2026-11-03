import { planCanvasVersionCheckpoint } from '../functions/planCanvasVersionCheckpoint';
import { z } from 'zod';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { DocumentVersionRestoreRequest, DocumentVersionSummary } from '@app/schemas';
import { type CanvasSnapshot } from '../../../../shared';
import { collectCanvasAssetIds } from '../../canvasDocument';
import type { CanvasHistoryCommitInput } from '../../canvasCommit';
import type { CanvasVersionHistoryOptions, CanvasVersionRecord, CanvasVersionBudgetStatus } from '../definitions/canvasVersionHistory';
import { createCanvasVersionRepository } from '../persistence/canvasVersionRepository';
import { canvasVersionId, canvasVersionRecordBytes, summarizeCanvasVersion } from '../functions/canvasVersionIdentity';
import { canvasVersionHash, canvasVersionSnapshot, decodeCanvasVersionInverse, encodeCanvasVersion, mergeCanvasVersionHead } from '../functions/canvasVersionCodec';
import { reconstructAllCanvasVersions, reconstructCanvasVersion } from '../functions/reconstructCanvasVersions';
import { planCanvasVersionCompaction } from '../functions/planCanvasVersionCompaction';

export interface CanvasCheckpointInput {
  readonly documentId: string; readonly reason: 'initialize' | 'idle' | 'interval' | 'close' | 'agent-group' | 'restore' | 'migration';
  readonly now?: number; readonly snapshot?: CanvasSnapshot; readonly restoredFrom?: DocumentVersionSummary['restoredFrom'];
}
/** 版本历史与会话撤销分开。recordCommit 是内容事务的一员，计时/维护只在成功提交之后执行。 */
export function createCanvasVersionHistoryRuntime(options: CanvasVersionHistoryOptions) {
  const repository = createCanvasVersionRepository(options.database), now = options.now ?? Date.now;
  const budgetBytes = options.budgetBytes ?? 100 * 1024 * 1024;
  const timers = new Map<string, { idle: ReturnType<typeof setTimeout>; deadline: ReturnType<typeof setTimeout>; deadlineAt: number }>();
  const maintenance = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  function requiredHead(documentId: string) { const head = repository.readHead(documentId); if (!head) throw new DocumentHistoryError('history_unavailable'); return head; }
  function list(documentId: string): DocumentVersionSummary[] { const head = repository.readHead(documentId); return head ? repository.readSummaries(documentId, head) : []; }
  function retainedAssetIds(documentId: string): readonly string[] { return repository.retainedAssetIds(documentId); }
  function budgetStatus(documentId: string): CanvasVersionBudgetStatus { const head = requiredHead(documentId); return { documentId, usedBytes: head.usedBytes, budgetBytes, overBudgetBytes: head.overBudgetBytes }; }
  function initialize(documentId: string, timestamp = now(), supplied?: CanvasSnapshot): void {
    options.database.transaction(() => {
      if (repository.readHead(documentId)) return;
      const snapshot = canvasVersionSnapshot(supplied ?? options.ports.readSnapshot(documentId));
      if (snapshot.documentId !== documentId) throw new DocumentHistoryError('version_conflict');
      const record: CanvasVersionRecord = { versionId: canvasVersionId(snapshot.sequence), sequence: snapshot.sequence, createdAt: timestamp, previousVersionId: null, hash: canvasVersionHash(snapshot), inverse: null, anchor: encodeCanvasVersion(snapshot), assetIds: collectCanvasAssetIds(snapshot.elements) };
      repository.writeRecord(documentId, record);
      const usedBytes = canvasVersionRecordBytes(record);
      repository.writeHead(documentId, { latestVersionId: record.versionId, sequence: record.sequence, changedAt: timestamp, dirtySince: null, inverse: null, bytesSinceAnchor: 0, usedBytes, overBudgetBytes: Math.max(0, usedBytes - budgetBytes) });
      options.ports.reconcileHistoryAssets(documentId, record.assetIds);
    }).immediate();
  }
  function checkpoint(input: CanvasCheckpointInput): DocumentVersionSummary | null {
    return options.database.transaction(() => {
      const snapshot = canvasVersionSnapshot(input.snapshot ?? options.ports.readSnapshot(input.documentId));
      initialize(input.documentId, input.now ?? now(), snapshot);
      const head = requiredHead(input.documentId);
      if (snapshot.documentId !== input.documentId || head.sequence !== snapshot.sequence) throw new DocumentHistoryError('version_conflict');
      if (input.reason === 'migration' && head.latestVersionId === canvasVersionId(head.sequence)) {
        const record = repository.readRecords(input.documentId).find(row => row.versionId === head.latestVersionId);
        if (!record || canvasVersionHash(snapshot) !== record.hash) throw new DocumentHistoryError('version_corrupt');
        if (!record.anchor) {
          const anchor = encodeCanvasVersion(snapshot), usedBytes = head.usedBytes + anchor.byteLength;
          repository.writeRecord(input.documentId, { ...record, anchor });
          repository.writeHead(input.documentId, { ...head, bytesSinceAnchor: 0, usedBytes, overBudgetBytes: Math.max(0, usedBytes - budgetBytes) });
        }
        return summarizeCanvasVersion(record, true);
      }
      if ((head.dirtySince === null || !head.inverse) && input.reason !== 'migration') return null;
      const planned = planCanvasVersionCheckpoint({ head, snapshot, budgetBytes, migration: input.reason === 'migration', restoredFrom: input.restoredFrom });
      repository.writeRecord(input.documentId, planned.record);
      repository.writeHead(input.documentId, planned.head);
      options.ports.reconcileHistoryAssets(input.documentId, repository.retainedAssetIds(input.documentId));
      return summarizeCanvasVersion(planned.record, true);
    }).immediate();
  }
  function cancelTimers(documentId: string): void { const previous = timers.get(documentId); if (previous) { clearTimeout(previous.idle); clearTimeout(previous.deadline); timers.delete(documentId); } }
  function report(documentId: string, error: unknown): void { options.ports.reportFailure(documentId, error); }
  function notifyBudget(status: CanvasVersionBudgetStatus): void { try { options.ports.budgetChanged?.(status); } catch (error) { report(status.documentId, error); } }
  function compact(documentId: string): CanvasVersionBudgetStatus {
    const head = requiredHead(documentId), records = repository.readRecords(documentId), current = options.ports.readSnapshot(documentId);
    const snapshots = reconstructAllCanvasVersions({ documentId, head, records, current });
    const protectedAssetIds = options.ports.protectedAssetIds(documentId), protectedAssets = new Set(protectedAssetIds);
    const historicalAssets = [...new Set(records.flatMap(record => record.assetIds))].filter(id => !protectedAssets.has(id));
    const rows = repository.readSummaries(documentId, head);
    const plan = planCanvasVersionCompaction({ rows, records, snapshots, headBytes: head.inverse?.byteLength ?? 0, budgetBytes, assetFacts: options.ports.assetByteFacts(documentId, historicalAssets), protectedAssetIds });
    options.database.transaction(() => {
      const live = requiredHead(documentId);
      if (live.sequence !== head.sequence || live.latestVersionId !== head.latestVersionId || JSON.stringify(repository.readSummaries(documentId, live)) !== JSON.stringify(rows)) throw new DocumentHistoryError('version_conflict');
      for (const record of plan.records) repository.writeRecord(documentId, record);
      repository.deleteExcept(documentId, plan.keepVersionIds);
      repository.writeHead(documentId, { ...live, usedBytes: plan.usedBytes, overBudgetBytes: plan.overBudgetBytes });
      options.ports.reconcileHistoryAssets(documentId, [...new Set(plan.records.flatMap(record => record.assetIds))]);
    }).immediate();
    const status = budgetStatus(documentId); notifyBudget(status); return status;
  }
  function requestMaintenance(documentId: string): void {
    if (stopped) return;
    const previous = maintenance.get(documentId); if (previous) clearTimeout(previous);
    const timer = setTimeout(() => { maintenance.delete(documentId); try { compact(documentId); } catch (error) { report(documentId, error); } }, 1000);
    timer.unref(); maintenance.set(documentId, timer);
  }
  function flush(documentId: string, reason: 'idle' | 'interval' | 'close'): void {
    cancelTimers(documentId);
    try { if (!repository.readHead(documentId)) return; checkpoint({ documentId, reason }); requestMaintenance(documentId); } catch (error) { report(documentId, error); }
  }
  function schedule(documentId: string): void {
    if (stopped) return;
    const head = requiredHead(documentId); if (head.dirtySince === null) { cancelTimers(documentId); return; }
    const previous = timers.get(documentId); if (previous) clearTimeout(previous.idle);
    const idle = setTimeout(() => flush(documentId, 'idle'), Math.max(0, 30_000 - (now() - head.changedAt)));
    const deadlineAt = head.dirtySince + 600_000;
    if (previous && previous.deadlineAt !== deadlineAt) clearTimeout(previous.deadline);
    const deadline = previous?.deadlineAt === deadlineAt ? previous.deadline : setTimeout(() => flush(documentId, 'interval'), Math.max(0, deadlineAt - now()));
    idle.unref(); deadline.unref(); timers.set(documentId, { idle, deadline, deadlineAt });
  }
  function recordCommit(history: CanvasHistoryCommitInput, input: { readonly beforeGroup?: boolean } = {}): (() => void) | undefined {
    if (!history.plan.changes.length) return undefined;
    const documentId = history.context.documentId;
    const before = { schemaVersion: 1, documentId, sequence: history.before.sequence, elements: history.before.elements.map(row => row.element) } satisfies CanvasSnapshot;
    initialize(documentId, history.context.now, before);
    if (input.beforeGroup) checkpoint({ documentId, reason: 'agent-group', now: history.context.now, snapshot: before });
    const head = requiredHead(documentId); if (head.sequence !== history.before.sequence) throw new DocumentHistoryError('version_conflict');
    const inverse = mergeCanvasVersionHead(decodeCanvasVersionInverse(head.inverse), history.plan.changes);
    const encoded = inverse.length ? encodeCanvasVersion(inverse) : null;
    const usedBytes = head.usedBytes + (encoded?.byteLength ?? 0) - (head.inverse?.byteLength ?? 0);
    repository.writeHead(documentId, { ...head, sequence: history.plan.state.sequence, changedAt: history.context.now, dirtySince: inverse.length ? head.dirtySince ?? history.context.now : null, inverse: encoded, usedBytes, overBudgetBytes: Math.max(0, usedBytes - budgetBytes) });
    return () => {
      // 通知和计时失败发生在正式提交以后，只报告；不能把已保存内容说成保存失败。
      try { schedule(documentId); if (input.beforeGroup) requestMaintenance(documentId); notifyBudget(budgetStatus(documentId)); } catch (error) { report(documentId, error); }
    };
  }
  function assertCurrent(request: Pick<DocumentVersionRestoreRequest, 'documentId' | 'expectedCurrentVersionId'>): void { if (canvasVersionId(requiredHead(request.documentId).sequence) !== request.expectedCurrentVersionId) throw new DocumentHistoryError('version_conflict'); }
  function preview(documentId: string, versionId: string): CanvasSnapshot {
    const head = requiredHead(documentId);
    const readCurrent = () => { const current = options.ports.readSnapshot(documentId); if (current.sequence !== head.sequence) throw new DocumentHistoryError('version_conflict'); return current; };
    if (versionId === canvasVersionId(head.sequence)) return canvasVersionSnapshot(readCurrent());
    try { return reconstructCanvasVersion({ documentId, versionId, records: repository.readRecords(documentId), head, readCurrent }); }
    catch (error) { if (error instanceof z.ZodError) throw new DocumentHistoryError('version_corrupt'); throw error; }
  }
  function prepareRestore(request: DocumentVersionRestoreRequest) {
    assertCurrent(request); const target = list(request.documentId).find(row => row.versionId === request.versionId);
    if (!target) throw new DocumentHistoryError('version_not_found');
    return { snapshot: preview(request.documentId, request.versionId), target };
  }
  function close(documentId: string): void { flush(documentId, 'close'); }
  function dispose(): void {
    stopped = true;
    const documents = new Set([...timers.keys(), ...maintenance.keys(), ...repository.dirtyDocuments()]);
    for (const timer of maintenance.values()) clearTimeout(timer); maintenance.clear();
    for (const documentId of documents) { flush(documentId, 'close'); try { if (repository.readHead(documentId)) compact(documentId); } catch (error) { report(documentId, error); } }
  }
  for (const documentId of repository.dirtyDocuments()) schedule(documentId);
  return { initialize, recordCommit, checkpoint, list, preview, prepareRestore, assertCurrent, compact, retainedAssetIds, budgetStatus, close, dispose };
}
