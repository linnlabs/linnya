import type { runSupervisor, telemetry } from '../../runtime-kernel';

type TelemetryEvent = telemetry.TelemetryEvent;
type RunCost = runSupervisor.RunCost;
type RunCostCollector = runSupervisor.RunCostCollector;

export interface TelemetryUsageTotal {
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  llmCallCount: number;
  toolCallCount: number;
}

interface TelemetryBucket extends TelemetryUsageTotal {
  childRunIds: Set<string>;
}

export interface MockTelemetryPortHarness {
  port: { emit(event: TelemetryEvent): void; flush(): Promise<void> };
  costCollector: RunCostCollector;
  emit(event: TelemetryEvent): void;
  getEvents(runId?: string): TelemetryEvent[];
  getTotalUsageByRun(runId: string): TelemetryUsageTotal;
  getKnownRunIds(): string[];
  reset(): void;
}

function cloneTelemetryEvent(event: TelemetryEvent): TelemetryEvent {
  return structuredClone(event);
}

function zeroTotal(): TelemetryUsageTotal {
  return {
    tokensInput: 0,
    tokensOutput: 0,
    latencyMs: 0,
    llmCallCount: 0,
    toolCallCount: 0,
  };
}

function createBucket(): TelemetryBucket {
  return {
    ...zeroTotal(),
    childRunIds: new Set<string>(),
  };
}

function snapshotBucket(bucket: TelemetryBucket | undefined): RunCost {
  if (!bucket) {
    return { tokensInput: 0, tokensOutput: 0, latencyMs: 0 };
  }
  return {
    tokensInput: bucket.tokensInput,
    tokensOutput: bucket.tokensOutput,
    latencyMs: bucket.latencyMs,
  };
}

/**
 * TelemetryPort 测试夹具。
 *
 * 中文备注：
 * - 它同时保留 ground truth 事件列表和一个 RunCostCollector；
 * - 父子 run 通过 scope.parentRunId 关联，方便验证 B.3 的 childrenTotal。
 */
export function createMockTelemetryPort(): MockTelemetryPortHarness {
  const events: TelemetryEvent[] = [];
  const buckets = new Map<string, TelemetryBucket>();

  function ensureBucket(runId: string): TelemetryBucket {
    const existing = buckets.get(runId);
    if (existing) {
      return existing;
    }
    const bucket = createBucket();
    buckets.set(runId, bucket);
    return bucket;
  }

  function ingest(event: TelemetryEvent): void {
    const runId = event.scope.runId ?? event.scope.turnId;
    if (!runId) {
      return;
    }

    const bucket = ensureBucket(runId);
    const parentRunId = event.scope.parentRunId;
    if (parentRunId && parentRunId !== runId) {
      ensureBucket(parentRunId).childRunIds.add(runId);
    }

    if (event.kind === 'llm_call') {
      bucket.tokensInput += event.usage?.promptTokens ?? 0;
      bucket.tokensOutput += event.usage?.completionTokens ?? 0;
      bucket.latencyMs += event.durationMs;
      bucket.llmCallCount += 1;
      return;
    }

    if (event.kind === 'tool_call') {
      bucket.latencyMs += event.durationMs;
      bucket.toolCallCount += 1;
    }
  }

  function emit(event: TelemetryEvent): void {
    const cloned = cloneTelemetryEvent(event);
    events.push(cloned);
    ingest(cloned);
  }

  return {
    port: {
      emit,
      async flush(): Promise<void> {},
    },

    costCollector: {
      snapshot(runId: string): RunCost {
        const own = snapshotBucket(buckets.get(runId));
        const childRunIds = buckets.get(runId)?.childRunIds;
        if (!childRunIds || childRunIds.size === 0) {
          return own;
        }

        const childrenTotal = Array.from(childRunIds).reduce<RunCost>((acc, childRunId) => {
          const child = snapshotBucket(buckets.get(childRunId));
          return {
            tokensInput: acc.tokensInput + child.tokensInput,
            tokensOutput: acc.tokensOutput + child.tokensOutput,
            latencyMs: (acc.latencyMs ?? 0) + (child.latencyMs ?? 0),
          };
        }, { tokensInput: 0, tokensOutput: 0, latencyMs: 0 });

        return { ...own, childrenTotal };
      },
    },

    emit,

    getEvents(runId?: string): TelemetryEvent[] {
      const selected = runId === undefined
        ? events
        : events.filter((event) => event.scope.runId === runId || event.scope.turnId === runId);
      return selected.map(cloneTelemetryEvent);
    },

    getTotalUsageByRun(runId: string): TelemetryUsageTotal {
      const bucket = buckets.get(runId);
      if (!bucket) {
        return zeroTotal();
      }
      return {
        tokensInput: bucket.tokensInput,
        tokensOutput: bucket.tokensOutput,
        latencyMs: bucket.latencyMs,
        llmCallCount: bucket.llmCallCount,
        toolCallCount: bucket.toolCallCount,
      };
    },

    getKnownRunIds(): string[] {
      return Array.from(buckets.keys()).sort();
    },

    reset(): void {
      events.length = 0;
      buckets.clear();
    },
  };
}
