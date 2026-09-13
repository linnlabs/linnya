import type {
  SlidesManualEditCommand,
  SlidesManualEditCommandResult,
} from '@plugin/slides/shared/authoringEditing';
import { logSlidesVerbose } from '../../../shared/diagnosticLogging';
import type { ManualEditPresentationTracePort } from '../definitions/manualEditPresentationTrace.js';

interface ActiveTrace {
  readonly commandId: string;
  readonly documentId: string;
  readonly operation: SlidesManualEditCommand['operation']['op'];
  readonly startedAt: number;
  retryCount: number;
  responseAt?: number;
  refreshAt?: number;
  presentedAt?: number;
  revision?: number;
}

interface PresentedFrame {
  readonly revision: number;
  readonly timestamp: number;
}

export interface ManualEditPresentationTraceDeps {
  readonly now: () => number;
  readonly log: (event: string, details: Record<string, unknown>) => void;
}

/** Renderer 本地单调时钟覆盖 input -> IPC -> refresh -> 完整帧呈现，commandId 与 backend trace 关联。 */
export class ManualEditPresentationTrace implements ManualEditPresentationTracePort {
  private readonly active = new Map<string, ActiveTrace>();
  private readonly presented = new Map<string, PresentedFrame>();

  constructor(private readonly deps: ManualEditPresentationTraceDeps) {}

  begin(command: SlidesManualEditCommand): void {
    const trace: ActiveTrace = {
      commandId: command.commandId,
      documentId: command.documentId,
      operation: command.operation.op,
      startedAt: this.deps.now(),
      retryCount: 0,
    };
    this.active.set(command.commandId, trace);
    this.emit('request_started', trace);
  }

  recordTransportRetry(commandId: string): void {
    const trace = this.active.get(commandId);
    if (!trace) return;
    trace.retryCount += 1;
    this.emit('transport_retry', trace);
  }

  recordResponse(result: SlidesManualEditCommandResult): void {
    const trace = this.active.get(result.commandId);
    if (!trace) return;
    trace.responseAt = this.deps.now();
    if (result.status !== 'committed') {
      this.emit('request_finished', trace, { outcome: result.status });
      this.active.delete(result.commandId);
      return;
    }
    trace.revision = result.revision;
    const frame = this.presented.get(result.documentId);
    if (frame && frame.revision >= result.revision) trace.presentedAt = frame.timestamp;
    this.emit('revision_committed', trace);
    this.tryComplete(trace);
  }

  recordTransportFailure(commandId: string): void {
    const trace = this.active.get(commandId);
    if (!trace) return;
    this.emit('request_finished', trace, { outcome: 'transport_failed' });
    this.active.delete(commandId);
  }

  recordRefreshCompleted(commandId: string): void {
    const trace = this.active.get(commandId);
    if (!trace) return;
    trace.refreshAt = this.deps.now();
    this.emit('refresh_completed', trace);
    this.tryComplete(trace);
  }

  recordPresented(documentId: string, revision: number): void {
    const timestamp = this.deps.now();
    this.presented.set(documentId, { revision, timestamp });
    for (const trace of this.active.values()) {
      if (trace.documentId !== documentId || trace.revision === undefined || revision < trace.revision) {
        continue;
      }
      trace.presentedAt = timestamp;
      this.tryComplete(trace);
    }
  }

  clear(): void {
    this.active.clear();
    this.presented.clear();
  }

  private tryComplete(trace: ActiveTrace): void {
    if (
      trace.responseAt === undefined
      || trace.refreshAt === undefined
      || trace.presentedAt === undefined
      || trace.revision === undefined
    ) return;
    this.emit('frame_presented', trace, {
      revision: trace.revision,
      inputToResponseMs: trace.responseAt - trace.startedAt,
      responseToRefreshMs: trace.refreshAt - trace.responseAt,
      refreshToFrameMs: trace.presentedAt - trace.refreshAt,
      inputToFrameMs: trace.presentedAt - trace.startedAt,
    });
    this.active.delete(trace.commandId);
  }

  private emit(
    event: string,
    trace: ActiveTrace,
    details: Record<string, unknown> = {},
  ): void {
    this.deps.log(event, {
      commandId: trace.commandId,
      documentId: trace.documentId,
      operation: trace.operation,
      retryCount: trace.retryCount,
      elapsedMs: this.deps.now() - trace.startedAt,
      ...details,
    });
  }
}

export const manualEditPresentationTrace = new ManualEditPresentationTrace({
  now: () => performance.now(),
  log: (event, details) => logSlidesVerbose('ManualEditTrace', event, details),
});
