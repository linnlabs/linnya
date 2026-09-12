import type {
  ExecutionAuditContextCompactionOutcome,
  ExecutionAuditContextCompactionRecord,
  ExecutionAuditContextCompactionRunSummary,
  ExecutionAuditEventFact,
  ExecutionAuditExport,
  ExecutionAuditModelSummary,
  ExecutionAuditRunLifecycleSummary,
  ExecutionAuditTelemetryRecord,
  ExecutionAuditTokenTotals,
  ExecutionAuditToolSummary,
  ExecutionAuditUsage,
} from '../definitions/executionAuditExport';
import { summarizeExecutionIntegrity } from './summarizeExecutionIntegrity';
import { summarizeWorkspaceDocumentDiagnostics } from './summarizeWorkspaceDocumentDiagnostics';

interface MutableTokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokensReported?: number;
  reasoningTokensReported?: number;
  cacheReadTokensReported?: number;
  cacheWriteTokensReported?: number;
}

interface MutableModelSummary {
  modelId: string;
  calls: number;
  durationMs: number;
  providerActualCalls: number;
  estimateCalls: number;
  missingUsageCalls: number;
  actualTokens: MutableTokenTotals;
}

interface MutableToolSummary {
  toolName: string;
  calls: number;
  failedCalls: number;
  durationMs: number;
  errorCodes: Set<string>;
}

interface MutableCompactionCounts {
  observations: number;
  attempts: number;
  completed: number;
  failed: number;
  insufficient: number;
  aborted: number;
  skipped: number;
}

interface MutableCompactionSummary extends MutableCompactionCounts {
  durationMs: number;
  compactionInputTokensReported?: number;
  summaryOutputTokensReported?: number;
  releasedTokensReported?: number;
  providerActualCalls: number;
  estimateCalls: number;
  missingUsageCalls: number;
  actualTokens: MutableTokenTotals;
}

interface MutableCompactionRunSummary extends MutableCompactionSummary {
  runId: string;
  parentRunId?: string;
  maxCompactionsPerRun: number;
  events: ExecutionAuditContextCompactionRecord[];
}

function emptyTokens(): MutableTokenTotals {
  return { inputTokens: 0, outputTokens: 0 };
}

function emptyCompactionSummary(): MutableCompactionSummary {
  return {
    observations: 0,
    attempts: 0,
    completed: 0,
    failed: 0,
    insufficient: 0,
    aborted: 0,
    skipped: 0,
    durationMs: 0,
    providerActualCalls: 0,
    estimateCalls: 0,
    missingUsageCalls: 0,
    actualTokens: emptyTokens(),
  };
}

function addReported(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  return next === undefined ? current : (current ?? 0) + next;
}

function addActualUsage(target: MutableTokenTotals, usage: ExecutionAuditUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.totalTokensReported = addReported(target.totalTokensReported, usage.totalTokens);
  target.reasoningTokensReported = addReported(
    target.reasoningTokensReported,
    usage.reasoningTokens,
  );
  target.cacheReadTokensReported = addReported(
    target.cacheReadTokensReported,
    usage.cacheReadTokens,
  );
  target.cacheWriteTokensReported = addReported(
    target.cacheWriteTokensReported,
    usage.cacheWriteTokens,
  );
}

function freezeTokens(tokens: MutableTokenTotals): ExecutionAuditTokenTotals {
  return { ...tokens };
}

function countCompactionOutcome(
  summary: MutableCompactionCounts,
  outcome: ExecutionAuditContextCompactionOutcome,
  generationAttempted: boolean,
): void {
  summary.observations += 1;
  summary[outcome] += 1;
  if (generationAttempted) summary.attempts += 1;
}

function addCompactionRecord(
  summary: MutableCompactionSummary,
  record: ExecutionAuditContextCompactionRecord,
): void {
  countCompactionOutcome(summary, record.outcome, record.generationAttempted);
  summary.durationMs += record.durationMs;
  summary.compactionInputTokensReported = addReported(
    summary.compactionInputTokensReported,
    record.compactionInputTokens,
  );
  summary.summaryOutputTokensReported = addReported(
    summary.summaryOutputTokensReported,
    record.summaryOutputTokens,
  );
  if (record.outcome === 'completed' && record.afterTokens !== undefined) {
    summary.releasedTokensReported = addReported(
      summary.releasedTokensReported,
      Math.max(0, record.beforeTokens - record.afterTokens),
    );
  }
  if (!record.generationAttempted) return;
  if (!record.usage) {
    summary.missingUsageCalls += 1;
  } else if (record.usage.confidence === 'actual') {
    summary.providerActualCalls += 1;
    addActualUsage(summary.actualTokens, record.usage);
  } else {
    summary.estimateCalls += 1;
  }
}

function freezeCompactionRun(
  summary: MutableCompactionRunSummary,
): ExecutionAuditContextCompactionRunSummary {
  const events = [...summary.events].sort(
    (left, right) => left.emittedAt - right.emittedAt,
  );
  const latestEvent = events[events.length - 1];
  return {
    ...summary,
    maxCompactionsPerRun:
      latestEvent?.maxCompactionsPerRun ?? summary.maxCompactionsPerRun,
    actualTokens: freezeTokens(summary.actualTokens),
    events,
  };
}

export function summarizeExecutionAudit(input: {
  readonly generatedAt: number;
  readonly runs: ExecutionAuditExport['runs'];
  readonly telemetry: readonly ExecutionAuditTelemetryRecord[];
  readonly eventFacts: readonly ExecutionAuditEventFact[];
}): ExecutionAuditExport {
  const models = new Map<string, MutableModelSummary>();
  const tools = new Map<string, MutableToolSummary>();
  const compactionsByRun = new Map<string, MutableCompactionRunSummary>();
  const lifecycleByRun = new Map<string, ExecutionAuditRunLifecycleSummary>();
  const lifecycleObservationCounts = new Map<string, number>();
  const totalTokens = emptyTokens();
  const compactionTotals = emptyCompactionSummary();
  let llmCalls = 0;
  let llmDurationMs = 0;
  let providerActualCalls = 0;
  let estimateCalls = 0;
  let missingUsageCalls = 0;
  let toolCalls = 0;
  let failedToolCalls = 0;
  let toolDurationMs = 0;

  for (const record of input.telemetry) {
    if (record.kind === 'llm_call') {
      llmCalls += 1;
      llmDurationMs += record.durationMs;
      const model = models.get(record.modelId) ?? {
        modelId: record.modelId,
        calls: 0,
        durationMs: 0,
        providerActualCalls: 0,
        estimateCalls: 0,
        missingUsageCalls: 0,
        actualTokens: emptyTokens(),
      };
      model.calls += 1;
      model.durationMs += record.durationMs;
      if (!record.usage) {
        missingUsageCalls += 1;
        model.missingUsageCalls += 1;
      } else if (record.usage.confidence === 'actual') {
        providerActualCalls += 1;
        model.providerActualCalls += 1;
        addActualUsage(totalTokens, record.usage);
        addActualUsage(model.actualTokens, record.usage);
      } else {
        estimateCalls += 1;
        model.estimateCalls += 1;
      }
      models.set(record.modelId, model);
      continue;
    }

    if (record.kind === 'tool_call') {
      toolCalls += 1;
      toolDurationMs += record.durationMs;
      if (!record.ok) failedToolCalls += 1;
      const tool = tools.get(record.toolName) ?? {
        toolName: record.toolName,
        calls: 0,
        failedCalls: 0,
        durationMs: 0,
        errorCodes: new Set<string>(),
      };
      tool.calls += 1;
      tool.durationMs += record.durationMs;
      if (!record.ok) tool.failedCalls += 1;
      if (record.errorCode) tool.errorCodes.add(record.errorCode);
      tools.set(record.toolName, tool);
      continue;
    }

    if (record.kind === 'context_compaction') {
      addCompactionRecord(compactionTotals, record);
      if (!record.runId) continue;
      const run = compactionsByRun.get(record.runId) ?? {
        ...emptyCompactionSummary(),
        runId: record.runId,
        ...(record.parentRunId ? { parentRunId: record.parentRunId } : {}),
        maxCompactionsPerRun: record.maxCompactionsPerRun,
        events: [],
      };
      addCompactionRecord(run, record);
      if (record.parentRunId) run.parentRunId = record.parentRunId;
      run.maxCompactionsPerRun = record.maxCompactionsPerRun;
      run.events.push(record);
      compactionsByRun.set(record.runId, run);
      continue;
    }

    if (!record.runId) continue;
    const terminalObservations = (lifecycleObservationCounts.get(record.runId) ?? 0) + 1;
    lifecycleObservationCounts.set(record.runId, terminalObservations);
    const previous = lifecycleByRun.get(record.runId);
    if (!previous || record.emittedAt >= previous.emittedAt) {
      lifecycleByRun.set(record.runId, {
        runId: record.runId,
        ...(record.parentRunId
          ? { parentRunId: record.parentRunId }
          : previous?.parentRunId
            ? { parentRunId: previous.parentRunId }
            : {}),
        terminalObservations,
        phase: record.phase,
        stepsUsed: record.stepsUsed,
        maxSteps: record.maxSteps,
        terminalReason: record.terminalReason,
        emittedAt: record.emittedAt,
      });
    } else {
      lifecycleByRun.set(record.runId, {
        ...previous,
        ...(!previous.parentRunId && record.parentRunId
          ? { parentRunId: record.parentRunId }
          : {}),
        terminalObservations,
      });
    }
  }

  const timestamps = input.telemetry.map(record => record.emittedAt);
  const byModel: ExecutionAuditModelSummary[] = [...models.values()]
    .sort((left, right) => left.modelId.localeCompare(right.modelId))
    .map(model => ({ ...model, actualTokens: freezeTokens(model.actualTokens) }));
  const byTool: ExecutionAuditToolSummary[] = [...tools.values()]
    .sort((left, right) => left.toolName.localeCompare(right.toolName))
    .map(tool => ({
      toolName: tool.toolName,
      calls: tool.calls,
      failedCalls: tool.failedCalls,
      durationMs: tool.durationMs,
      errorCodes: [...tool.errorCodes].sort(),
    }));
  const compactionByRun = [...compactionsByRun.values()]
    .sort((left, right) => left.runId.localeCompare(right.runId))
    .map(freezeCompactionRun);
  const runLifecycleByRun = [...lifecycleByRun.values()]
    .sort((left, right) => left.runId.localeCompare(right.runId));
  const runs = input.runs.map(run => {
    const lifecycle = lifecycleByRun.get(run.runId);
    return {
      ...run,
      ...(lifecycle ? { executionStepsUsed: lifecycle.stepsUsed } : {}),
      ...(run.runIterationsUsed === undefined && run.iterationsUsed !== undefined
        ? { runIterationsUsed: run.iterationsUsed }
        : {}),
    };
  });
  const integrity = summarizeExecutionIntegrity(input.eventFacts);

  return {
    generatedAt: input.generatedAt,
    runs,
    sourceWindow: {
      telemetryEvents: input.telemetry.length,
      earliestTelemetryAt: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      latestTelemetryAt: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
      eventFacts: input.eventFacts.length,
    },
    llm: {
      calls: llmCalls,
      durationMs: llmDurationMs,
      providerActualCalls,
      estimateCalls,
      missingUsageCalls,
      actualTokens: freezeTokens(totalTokens),
      byModel,
    },
    tools: {
      calls: toolCalls,
      failedCalls: failedToolCalls,
      durationMs: toolDurationMs,
      byTool,
    },
    ...integrity,
    workspaceDocuments: summarizeWorkspaceDocumentDiagnostics(input.eventFacts),
    contextCompaction: {
      ...compactionTotals,
      actualTokens: freezeTokens(compactionTotals.actualTokens),
      byRun: compactionByRun,
    },
    runLifecycle: {
      byRun: runLifecycleByRun,
    },
  };
}
