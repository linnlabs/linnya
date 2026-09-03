import { computed, shallowRef, watch } from 'vue';
import type { SSESubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import type { SubrunTraceBucket } from '../definitions/subrunTrace';
import type { IndexedSubrunTraceEvent } from '../functions/createAppendOnlySubrunStepProjector';
import { findSubrunTraceBucket } from '../functions/hasSubrunTraceBucket';
import { ToolCompactStepProjectionError } from '../../../ports/toolCompactStepProjectionPort';

export interface AppendOnlySubrunTraceAdmissionError {
  readonly bucketId: string | null;
  readonly processedLength: number;
  readonly targetLength: number;
  readonly traceVersion: number;
  readonly fingerprint: string;
  readonly projection?: {
    readonly sourceToolName: string;
    readonly uiKey?: string;
    readonly toolCallId: string;
  };
  readonly cause: unknown;
}

/**
 * 监听 append-only trace 版本，但把可抛错的业务 admission 调度到 Vue reactive flush 之外。
 * 同一微任务内到达的版本只接纳最新快照，失败时 processedLength 不前移。
 */
export function useAppendOnlySubrunTrace(params: {
  subrunTrace: () => unknown;
  version: () => number;
  subrunId?: () => string;
  onReset: () => void;
  onEvents: (events: readonly IndexedSubrunTraceEvent[]) => void;
  onAdmissionError?: (error: AppendOnlySubrunTraceAdmissionError) => void;
}) {
  const bucket = computed<SubrunTraceBucket | null>(() => {
    void params.version();
    const expectedId = typeof params.subrunId === 'function' ? params.subrunId() : '';
    return findSubrunTraceBucket(params.subrunTrace(), expectedId || undefined);
  });
  const admissionError = shallowRef<AppendOnlySubrunTraceAdmissionError | null>(null);

  let processedLength = 0;
  let processedBucket: SubrunTraceBucket | null = null;
  let requestedRevision = 0;
  let scheduled = false;
  const reportedFailureFingerprints = new Set<string>();

  function requestAdmission(): void {
    requestedRevision += 1;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flushAdmission);
  }

  function flushAdmission(): void {
    scheduled = false;
    const targetRevision = requestedRevision;
    const currentBucket = bucket.value;
    const traceVersion = params.version();

    try {
      if (currentBucket !== processedBucket) {
        params.onReset();
        processedBucket = currentBucket;
        processedLength = 0;
      }
      if (!currentBucket) {
        admissionError.value = null;
        return;
      }

      const events = currentBucket.events;
      if (events.length < processedLength) {
        params.onReset();
        processedLength = 0;
      }
      const additions: IndexedSubrunTraceEvent[] = [];
      for (let index = processedLength; index < events.length; index += 1) {
        const event = events[index];
        if (event) additions.push({ event, index });
      }
      if (additions.length > 0) params.onEvents(additions);
      processedLength = events.length;
      admissionError.value = null;
    } catch (cause) {
      const projection = cause instanceof ToolCompactStepProjectionError
        ? {
            sourceToolName: cause.context.sourceToolName,
            uiKey: cause.context.uiKey,
            toolCallId: cause.context.toolCallId,
          }
        : undefined;
      const fingerprint = [
        currentBucket?.subrun_id ?? 'no-bucket',
        traceVersion,
        projection?.toolCallId ?? 'unknown-call',
        projection?.uiKey ?? projection?.sourceToolName ?? 'unknown-projector',
      ].join('|');
      const error: AppendOnlySubrunTraceAdmissionError = {
        bucketId: currentBucket?.subrun_id ?? null,
        processedLength,
        targetLength: currentBucket?.events.length ?? 0,
        traceVersion,
        fingerprint,
        projection,
        cause,
      };
      admissionError.value = error;
      if (!reportedFailureFingerprints.has(fingerprint)) {
        reportedFailureFingerprints.add(fingerprint);
        params.onAdmissionError?.(error);
      }
    } finally {
      if (requestedRevision !== targetRevision) requestAdmission();
    }
  }

  watch(
    () => [bucket.value, params.version()] as const,
    requestAdmission,
    { immediate: true },
  );

  return {
    bucket,
    admissionError,
  };
}
