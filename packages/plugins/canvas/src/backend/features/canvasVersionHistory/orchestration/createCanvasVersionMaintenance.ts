import { CANVAS_VERSION_IDLE_MS, CANVAS_VERSION_DEADLINE_MS, CANVAS_VERSION_MAINTENANCE_DELAY_MS } from '../definitions/canvasVersionMaintenance';
import type { CanvasVersionMaintenanceOptions } from '../definitions/canvasVersionMaintenance';

/** timer 属于实例生命周期；提交失败不调用这里，停用不遗留后台写入。 */
export function createCanvasVersionMaintenance(options: CanvasVersionMaintenanceOptions) {
  const timers = new Map<string, { idle: ReturnType<typeof setTimeout>; deadline: ReturnType<typeof setTimeout>; deadlineAt: number }>();
  const maintenance = new Map<string, ReturnType<typeof setTimeout>>(); let stopped = false;
  function cancelTimers(documentId: string): void { const previous = timers.get(documentId); if (previous) { clearTimeout(previous.idle); clearTimeout(previous.deadline); timers.delete(documentId); } }
  function cancelMaintenance(documentId: string): void { const previous = maintenance.get(documentId); if (previous) clearTimeout(previous); maintenance.delete(documentId); }
  function requestMaintenance(documentId: string): void {
    if (stopped) return;
    cancelMaintenance(documentId);
    const timer = setTimeout(() => {
      maintenance.delete(documentId);
      try { if (options.readHead(documentId)) options.compact(documentId); } catch (error) { options.reportFailure(documentId, error); }
    }, CANVAS_VERSION_MAINTENANCE_DELAY_MS);
    timer.unref(); maintenance.set(documentId, timer);
  }
  function flush(documentId: string, reason: 'idle' | 'interval' | 'close'): void {
    cancelTimers(documentId);
    try {
      if (!options.readHead(documentId)) { cancelMaintenance(documentId); return; }
      options.checkpoint(documentId, reason); requestMaintenance(documentId);
    } catch (error) { options.reportFailure(documentId, error); }
  }
  function schedule(documentId: string): void {
    if (stopped) return;
    const head = options.readHead(documentId);
    if (!head || head.dirtySince === null) { cancelTimers(documentId); return; }
    const previous = timers.get(documentId); if (previous) clearTimeout(previous.idle);
    const idle = setTimeout(() => flush(documentId, 'idle'), Math.max(0, CANVAS_VERSION_IDLE_MS - (options.now() - head.changedAt)));
    const deadlineAt = head.dirtySince + CANVAS_VERSION_DEADLINE_MS;
    if (previous && previous.deadlineAt !== deadlineAt) clearTimeout(previous.deadline);
    const deadline = previous?.deadlineAt === deadlineAt ? previous.deadline : setTimeout(() => flush(documentId, 'interval'), Math.max(0, deadlineAt - options.now()));
    idle.unref(); deadline.unref(); timers.set(documentId, { idle, deadline, deadlineAt });
  }
  function dispose(): void {
    stopped = true;
    const documents = new Set([...timers.keys(), ...maintenance.keys(), ...options.dirtyDocuments()]);
    for (const timer of maintenance.values()) clearTimeout(timer); maintenance.clear();
    for (const documentId of documents) {
      flush(documentId, 'close');
      try { if (options.readHead(documentId)) options.compact(documentId); } catch (error) { options.reportFailure(documentId, error); }
    }
  }
  for (const documentId of options.dirtyDocuments()) schedule(documentId);
  return { schedule, requestMaintenance, close: (documentId: string) => flush(documentId, 'close'), dispose };
}
