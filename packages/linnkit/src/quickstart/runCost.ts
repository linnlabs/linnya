import type { runSupervisor, telemetry } from '../runtime-kernel';

type RunCost = runSupervisor.RunCost;
type RunCostCollector = runSupervisor.RunCostCollector;
type TelemetryEvent = telemetry.TelemetryEvent;
type TelemetryPort = telemetry.TelemetryPort;

interface CostBucket {
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
}

function emptyCost(): RunCost {
  return { tokensInput: 0, tokensOutput: 0, latencyMs: 0 };
}

export class QuickstartRunCostCollector implements RunCostCollector {
  private readonly buckets = new Map<string, CostBucket>();

  ingest(event: TelemetryEvent): void {
    if (event.kind !== 'llm_call') return;
    const runId = event.scope.runId ?? event.scope.turnId;
    if (!runId) return;

    const bucket = this.buckets.get(runId) ?? { tokensInput: 0, tokensOutput: 0, latencyMs: 0 };
    bucket.tokensInput += event.usage?.promptTokens ?? 0;
    bucket.tokensOutput += event.usage?.completionTokens ?? 0;
    bucket.latencyMs += event.durationMs;
    this.buckets.set(runId, bucket);
  }

  snapshot(runId: string): RunCost {
    const bucket = this.buckets.get(runId);
    if (!bucket) return emptyCost();
    return {
      tokensInput: bucket.tokensInput,
      tokensOutput: bucket.tokensOutput,
      latencyMs: bucket.latencyMs,
    };
  }
}

export function createQuickstartTelemetryPort(
  collector: QuickstartRunCostCollector,
): TelemetryPort {
  return {
    emit(event: TelemetryEvent): void {
      collector.ingest(event);
    },
  };
}
