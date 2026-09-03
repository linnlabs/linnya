import type {
  ExecutionAuditRunRecord,
  ExecutionAuditEventFact,
  ExecutionAuditTelemetryRecord,
} from '../definitions/executionAuditExport';

export function selectExecutionAuditScope(
  runs: readonly ExecutionAuditRunRecord[],
  telemetry: readonly ExecutionAuditTelemetryRecord[],
  eventFacts: readonly ExecutionAuditEventFact[],
  requestedRunId?: string,
): {
  readonly runs: readonly ExecutionAuditRunRecord[];
  readonly telemetry: readonly ExecutionAuditTelemetryRecord[];
  readonly eventFacts: readonly ExecutionAuditEventFact[];
} | null {
  if (!requestedRunId) return { runs, telemetry, eventFacts };
  if (!runs.some(run => run.runId === requestedRunId)) return null;

  const selectedIds = new Set([requestedRunId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of runs) {
      if (run.parentRunId && selectedIds.has(run.parentRunId) && !selectedIds.has(run.runId)) {
        selectedIds.add(run.runId);
        changed = true;
      }
    }
  }

  return {
    runs: runs.filter(run => selectedIds.has(run.runId)),
    telemetry: telemetry.filter(record =>
      (record.runId !== undefined && selectedIds.has(record.runId))
      || (record.parentRunId !== undefined && selectedIds.has(record.parentRunId))),
    eventFacts: eventFacts.filter(fact => selectedIds.has(fact.runId)),
  };
}
