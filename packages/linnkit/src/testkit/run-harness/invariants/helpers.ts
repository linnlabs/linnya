import type { RuntimeEvent } from '../../../contracts';
import type { runSupervisor, telemetry } from '../../../runtime-kernel';
import type { RunInvariantFailure, RunInvariantId } from './types';

type RunCost = runSupervisor.RunCost;
type RunRecord = runSupervisor.RunRecord;
type TelemetryEvent = telemetry.TelemetryEvent;

export function failure(
  id: RunInvariantId,
  title: string,
  message: string,
  details?: Record<string, unknown>,
): RunInvariantFailure {
  return details === undefined ? { id, title, message } : { id, title, message, details };
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function readEventRunId(event: RuntimeEvent): string | undefined {
  return event.run_id;
}

export function runIds(records: readonly RunRecord[]): Set<string> {
  return new Set(records.map((record) => record.runId));
}

export function parentByChild(records: readonly RunRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of records) {
    if (record.parentRunId) {
      map.set(record.runId, record.parentRunId);
    }
  }
  return map;
}

export function telemetryRunId(event: TelemetryEvent): string | undefined {
  return event.scope.runId ?? event.scope.turnId;
}

export function isNonNegativeCost(cost: RunCost): boolean {
  return cost.tokensInput >= 0
    && cost.tokensOutput >= 0
    && (cost.latencyMs ?? 0) >= 0
    && (cost.totalCostUsd ?? 0) >= 0
    && (cost.childrenTotal === undefined || isNonNegativeCost(cost.childrenTotal));
}

export function addCost(left: RunCost, right: RunCost): RunCost {
  return {
    tokensInput: left.tokensInput + right.tokensInput,
    tokensOutput: left.tokensOutput + right.tokensOutput,
    latencyMs: (left.latencyMs ?? 0) + (right.latencyMs ?? 0),
    totalCostUsd: left.totalCostUsd === undefined && right.totalCostUsd === undefined
      ? undefined
      : (left.totalCostUsd ?? 0) + (right.totalCostUsd ?? 0),
  };
}
