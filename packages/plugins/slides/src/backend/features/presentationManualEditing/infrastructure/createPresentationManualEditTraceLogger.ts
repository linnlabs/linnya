import type { PluginLoggerPort } from '@plugin/backend/workspaceRuntime';
import type {
  PresentationManualEditTraceEvent,
  PresentationManualEditTracePort,
} from '../definitions/presentationManualEditTrace.js';

/** commandId 贯穿 Renderer、IPC 与 Backend；这里只记录阶段和耗时，不记录正文或源码。 */
export function createPresentationManualEditTraceLogger(
  logger: PluginLoggerPort,
  now: () => number = Date.now,
): PresentationManualEditTracePort {
  const startedAt = new Map<string, number>();
  return {
    record(event: PresentationManualEditTraceEvent): void {
      const timestamp = now();
      const start = startedAt.get(event.commandId) ?? timestamp;
      if (event.stage === 'request_received') startedAt.set(event.commandId, timestamp);
      logger.info('slides_manual_edit.backend_trace', {
        ...event,
        timestamp,
        elapsedMs: timestamp - start,
      });
      if (
        event.stage === 'receipt_reused'
        || event.stage === 'revision_committed'
        || event.stage === 'request_rejected'
      ) {
        startedAt.delete(event.commandId);
      }
    },
  };
}
