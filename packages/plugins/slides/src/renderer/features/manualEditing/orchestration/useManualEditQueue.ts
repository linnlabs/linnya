import { logSlidesVerbose } from '../../../shared/diagnosticLogging';
import { onScopeDispose, watch } from 'vue';
import type { ManualEditIntent } from '../definitions/manualEditingTypes';
import type { ManualEditQueueEntry, ManualEditSettlement, ManualEditSubmissionPort } from '../definitions/manualEditQueue';
import type { ManualEditQueuePorts } from '../definitions/manualEditQueuePorts';
import { appendManualEditQueueEntry } from '../functions/appendManualEditQueueEntry';
import { canAdmitManualEdit, isManualEditSnapshotReady } from '../functions/manualEditQueueReadiness';
import { readManualEditErrorMessage, describeManualEditQueueFailure } from '../functions/manualEditOutcomeMessage';
import { useSlidesManualEditingStore } from '../store/slidesManualEditingStore';
import { submitManualEdit } from './submitManualEdit';

/** 页面提供存储/IPC 端口；队列负责串行精确版本写入，绝不拥有焦点或输入会话。 */
export function useManualEditQueue(ports: ManualEditQueuePorts): ManualEditSubmissionPort {
  const store = useSlidesManualEditingStore();
  const receipts = new Map<string, (result: ManualEditSettlement) => void>();
  let epoch = 0;
  let processing = false;

  function settle(entry: ManualEditQueueEntry, result: ManualEditSettlement): void {
    logSlidesVerbose('ManualEditQueue', 'settled', { clientOperationIds: entry.clientOperationIds, status: result.status });
    for (const id of entry.clientOperationIds) {
      receipts.get(id)?.(result);
      receipts.delete(id);
    }
  }

  function fail(entry: ManualEditQueueEntry, commandId: string, message: string): void {
    const summary = describeManualEditQueueFailure(message, entry, store.queue, ports.message);
    settle(entry, { status: 'failed', commandId, message });
    // 后续操作基于失败的预览，不能静默继续写。逐个通知调用方保留可恢复草稿。
    for (const waiting of store.queue) {
      settle(waiting, { status: 'blocked', dependencyCommandId: commandId, message });
    }
    store.setQueue([]);
    store.setSubmission({ phase: 'idle' });
    store.setError(summary);
  }

  async function refreshPresentation(): Promise<void> {
    const state = store.submission;
    const documentId = ports.readSnapshot().documentId;
    if (state.phase !== 'awaiting_frame' || !documentId) return;
    const requestEpoch = epoch;
    try {
      await ports.refreshDocument(documentId, state.revision);
      if (requestEpoch !== epoch) return;
      ports.trace?.recordRefreshCompleted(state.commandId);
      if (store.submission.phase === 'awaiting_frame' && store.submission.commandId === state.commandId) {
        store.setError(null);
      }
    } catch {
      if (requestEpoch === epoch && store.submission.phase === 'awaiting_frame'
        && store.submission.commandId === state.commandId) {
        // 写入已经成功；刷新失败绝不能被报告成保存失败，更不能重放同一次修改。
        store.setError(ports.message('slides.manualEditing.error.presentationRefreshFailed'));
      }
    }
  }

  async function processQueue(): Promise<void> {
    const state = store.submission;
    if (state.phase === 'awaiting_frame' && store.presentedRevision !== null
      && store.presentedRevision >= state.revision) {
      settle(state.entry, { status: 'presented', commandId: state.commandId, revision: state.revision });
      store.setSubmission({ phase: 'idle' });
      store.setError(null);
    }
    if (processing || store.submission.phase !== 'idle') return;
    const snapshot = ports.readSnapshot();
    if (!isManualEditSnapshotReady(snapshot) || !snapshot.documentId) return;
    const [entry, ...remaining] = store.queue;
    if (!entry) return;
    const commandId = entry.clientOperationIds[0];
    const requestEpoch = epoch;
    processing = true;
    store.setQueue(remaining);
    store.setSubmission({ phase: 'submitting', entry, commandId });
    logSlidesVerbose('ManualEditQueue', 'dispatch', { documentId: snapshot.documentId, commandId, clientOperationIds: entry.clientOperationIds });
    try {
      const result = await submitManualEdit({ ...snapshot, documentId: snapshot.documentId, operation: entry.intent.operation }, {
        createCommandId: () => commandId, submit: ports.submit, trace: ports.trace,
      });
      if (requestEpoch !== epoch) return;
      if (result.status === 'committed') {
        store.setSubmission({ phase: 'awaiting_frame', entry, commandId, revision: result.revision });
        await refreshPresentation();
      } else {
        fail(entry, commandId, readManualEditErrorMessage(result, ports.message)
          ?? ports.message('slides.manualEditing.error.saveFailed'));
        if (result.status === 'conflict') {
          try { await ports.refreshDocument(snapshot.documentId); } catch {
            // 保留原冲突说明；不能把刷新失败再次当成一次命令失败清掉后来输入。
            if (requestEpoch === epoch) store.setError(ports.message('slides.manualEditing.error.snapshotUnavailable'));
          }
        }
      }
    } catch (error) {
      if (requestEpoch === epoch) {
        fail(entry, commandId, error instanceof Error ? error.message : ports.message('slides.manualEditing.error.saveFailed'));
      }
    } finally {
      if (requestEpoch === epoch) {
        processing = false;
        void processQueue();
      }
    }
  }

  function enqueue(intent: ManualEditIntent) {
    const clientOperationId = ports.createCommandId();
    if (!canAdmitManualEdit(ports.readSnapshot())) {
      const message = ports.message('slides.manualEditing.error.snapshotUnavailable');
      store.setError(message);
      return { clientOperationId, settled: Promise.resolve<ManualEditSettlement>({
        status: 'failed', commandId: clientOperationId, message,
      }) };
    }
    const settled = new Promise<ManualEditSettlement>(resolve => receipts.set(clientOperationId, resolve));
    store.setQueue(appendManualEditQueueEntry(store.queue, { intent, clientOperationIds: [clientOperationId] }));
    // 后续输入不能抹掉“已保存但未刷新”的恢复入口。
    if (store.submission.phase !== 'awaiting_frame') store.setError(null);
    void processQueue();
    return { clientOperationId, settled };
  }

  function reset(): void {
    epoch += 1;
    processing = false;
    for (const resolve of receipts.values()) resolve({ status: 'cancelled' });
    receipts.clear();
    store.$reset();
  }

  watch(() => ports.readSnapshot().documentId, reset, { flush: 'sync', immediate: true });
  watch(() => [ports.readSnapshot(), store.presentedRevision, store.submission, store.queue], () => { void processQueue(); });
  onScopeDispose(reset);
  return { enqueue, refreshPresentation };
}
