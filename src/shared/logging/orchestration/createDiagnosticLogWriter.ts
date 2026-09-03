import {
  DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
  DEFAULT_DIAGNOSTIC_LOG_WRITER_LIMITS,
  type DiagnosticLogDropCounts,
  type DiagnosticLogInput,
  type DiagnosticLogProjectionLimits,
  type DiagnosticLogRecord,
  type DiagnosticLogShutdownResult,
  type DiagnosticLogSink,
  type DiagnosticLogWriter,
  type DiagnosticLogWriterLimits,
  type DiagnosticLogWriterStatus,
  type DiagnosticLogWriteResult,
} from '../definitions/diagnosticLogContract';
import { projectDiagnosticLogEntry } from '../functions/projectDiagnosticLogEntry';

const LEVEL_WEIGHT: Readonly<Record<DiagnosticLogRecord['level'], number>> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export interface CreateDiagnosticLogWriterOptions {
  readonly sink: DiagnosticLogSink;
  readonly projectionLimits?: DiagnosticLogProjectionLimits;
  readonly writerLimits?: DiagnosticLogWriterLimits;
  readonly onSinkDisabled?: (error: unknown) => void;
}

function snapshotDrops(dropped: DiagnosticLogDropCounts): DiagnosticLogDropCounts {
  return { queue: dropped.queue, sink: dropped.sink, closed: dropped.closed };
}

export function createDiagnosticLogWriter(options: CreateDiagnosticLogWriterOptions): DiagnosticLogWriter {
  const projectionLimits = options.projectionLimits ?? DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS;
  const limits = options.writerLimits ?? DEFAULT_DIAGNOSTIC_LOG_WRITER_LIMITS;
  const queue: DiagnosticLogRecord[] = [];
  const dropped = { queue: 0, sink: 0, closed: 0 };
  let queuedBytes = 0;
  let writtenEntries = 0;
  let state: DiagnosticLogWriterStatus['state'] = 'open';
  let sinkFailure: unknown;
  let pumpPromise: Promise<void> | undefined;

  function status(): DiagnosticLogWriterStatus {
    return {
      state,
      queuedEntries: queue.length,
      queuedBytes,
      writtenEntries,
      dropped: snapshotDrops(dropped),
      ...(sinkFailure === undefined ? {} : { sinkFailure }),
    };
  }

  function fits(record: DiagnosticLogRecord): boolean {
    return queue.length < limits.maxQueueEntries
      && queuedBytes + record.utf8Bytes <= limits.maxQueueBytes;
  }

  function removeAt(index: number): void {
    const removed = queue.splice(index, 1)[0];
    if (removed) queuedBytes -= removed.utf8Bytes;
  }

  function makeRoomFor(record: DiagnosticLogRecord): boolean {
    if (fits(record)) return true;
    const incomingWeight = LEVEL_WEIGHT[record.level];
    if (incomingWeight < LEVEL_WEIGHT.WARN) return false;

    // 队列拥塞时让高等级终态覆盖较早低等级摘要，但总容量始终不能突破。
    while (!fits(record) && queue.length > 0) {
      // 必须先淘汰严格低等级摘要。若直接从队首匹配“不高于”，新的 ERROR 会在
      // 后面仍有大量 INFO 时误删较早 ERROR，破坏压力门要求保留的终态诊断。
      const lowerPriorityIndex = queue.findIndex(
        entry => LEVEL_WEIGHT[entry.level] < incomingWeight,
      );
      const replaceableIndex = lowerPriorityIndex >= 0
        ? lowerPriorityIndex
        : queue.findIndex(entry => LEVEL_WEIGHT[entry.level] === incomingWeight);
      if (replaceableIndex < 0) return false;
      removeAt(replaceableIndex);
      dropped.queue += 1;
    }
    return fits(record);
  }

  function takeBatch(): DiagnosticLogRecord[] {
    const batch: DiagnosticLogRecord[] = [];
    let batchBytes = 0;
    while (queue.length > 0 && batch.length < limits.maxBatchEntries) {
      const next = queue[0];
      if (!next) break;
      if (batch.length > 0 && batchBytes + next.utf8Bytes > limits.maxBatchBytes) break;
      queue.shift();
      queuedBytes -= next.utf8Bytes;
      batch.push(next);
      batchBytes += next.utf8Bytes;
    }
    return batch;
  }

  async function pump(): Promise<void> {
    while (queue.length > 0 && state !== 'sink_disabled') {
      const batch = takeBatch();
      try {
        await options.sink.write(batch);
        writtenEntries += batch.length;
      } catch (error: unknown) {
        sinkFailure = error;
        state = 'sink_disabled';
        dropped.sink += batch.length + queue.length;
        queue.length = 0;
        queuedBytes = 0;
        try {
          options.onSinkDisabled?.(error);
        } catch {
          // 错误报告本身（例如已关闭的 stderr）不能让 pump 产生未处理 rejection。
        }
      }
    }
    if (state === 'closing' && queue.length === 0) state = 'closed';
  }

  function schedulePump(): void {
    if (pumpPromise) return;
    pumpPromise = Promise.resolve()
      .then(pump)
      .finally(() => {
        pumpPromise = undefined;
        if (queue.length > 0 && state !== 'sink_disabled') schedulePump();
      });
  }

  function writeRecord(record: DiagnosticLogRecord): DiagnosticLogWriteResult {
    if (state !== 'open') {
      dropped.closed += 1;
      return { accepted: false, reason: state === 'sink_disabled' ? 'sink_disabled' : 'closed' };
    }
    if (!makeRoomFor(record)) {
      dropped.queue += 1;
      return { accepted: false, reason: 'queue_full' };
    }
    queue.push(record);
    queuedBytes += record.utf8Bytes;
    schedulePump();
    return { accepted: true };
  }

  function write(input: DiagnosticLogInput): DiagnosticLogWriteResult {
    return writeRecord(projectDiagnosticLogEntry(input, projectionLimits));
  }

  async function shutdown(timeoutMs: number = limits.shutdownTimeoutMs): Promise<DiagnosticLogShutdownResult> {
    if (state === 'open') state = 'closing';
    if (state === 'sink_disabled') return { complete: true, status: status() };
    schedulePump();

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      (pumpPromise ?? Promise.resolve()).then(() => true),
      new Promise<boolean>(resolve => {
        timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return { complete: completed && state === 'closed', status: status() };
  }

  return { write, writeRecord, getStatus: status, shutdown };
}
