export interface ExecutionAuditRunRecord {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly agentSpecId?: string;
  readonly status:
    | 'pending'
    | 'running'
    | 'awaiting_user'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly executionStepsUsed?: number;
  readonly runIterationsUsed?: number;
  readonly iterationsUsed?: number;
  readonly errorCode?: string;
}

export interface ExecutionAuditUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly confidence: 'estimate' | 'provider-estimate' | 'actual';
}

interface ExecutionAuditTelemetryBase {
  readonly runId?: string;
  readonly parentRunId?: string;
  readonly emittedAt: number;
}

interface ExecutionAuditDurationTelemetryBase extends ExecutionAuditTelemetryBase {
  readonly durationMs: number;
}

export type ExecutionAuditContextCompactionOutcome =
  | 'skipped'
  | 'completed'
  | 'failed'
  | 'insufficient'
  | 'aborted';

export type ExecutionAuditRunTerminalReason =
  | 'completed'
  | 'awaiting_user'
  | 'step_budget_forced_completion'
  | 'step_budget_exhausted'
  | 'capacity_failed'
  | 'failed'
  | 'cancelled';

export type ExecutionAuditTelemetryRecord =
  | (ExecutionAuditDurationTelemetryBase & {
      readonly kind: 'llm_call';
      readonly modelId: string;
      readonly usage?: ExecutionAuditUsage;
    })
  | (ExecutionAuditDurationTelemetryBase & {
      readonly kind: 'tool_call';
      readonly toolName: string;
      readonly ok: boolean;
      readonly errorCode?: string;
    })
  | (ExecutionAuditDurationTelemetryBase & {
      readonly kind: 'context_compaction';
      readonly modelId: string;
      readonly compactionIndex: number;
      readonly maxCompactionsPerRun: number;
      readonly generationAttempted: boolean;
      readonly triggerRatio: number;
      readonly targetRatio: number;
      readonly beforeTokens: number;
      readonly inputBudgetTokens: number;
      readonly compactionInputTokens?: number;
      readonly afterTokens?: number;
      readonly replacedMessageCount: number;
      readonly replacedToolGroupCount: number;
      readonly keptToolGroupCount: number;
      readonly summaryOutputTokens?: number;
      readonly compressionRatio?: number;
      readonly usage?: ExecutionAuditUsage;
      readonly outcome: ExecutionAuditContextCompactionOutcome;
      readonly suppressedReason?: string;
      readonly forcedPhaseRecovery: boolean;
      readonly targetUnreachable?: boolean;
      readonly errorCode?: string;
      readonly failureReason?: string;
    })
  | (ExecutionAuditTelemetryBase & {
      readonly kind: 'run_lifecycle';
      readonly phase: 'completed' | 'failed' | 'cancelled';
      readonly stepsUsed: number;
      readonly maxSteps: number;
      readonly terminalReason: ExecutionAuditRunTerminalReason;
    });

export interface ExecutionAuditRunPort {
  listByConversation(conversationId: string): Promise<readonly ExecutionAuditRunRecord[]>;
}

export interface ExecutionAuditTelemetryPort {
  listByConversation(conversationId: string): Promise<readonly ExecutionAuditTelemetryRecord[]>;
}

export type ExecutionAuditEventFact =
  | {
      readonly kind: 'tool_decision';
      readonly runId: string;
      readonly parentRunId?: string;
      readonly emittedAt: number;
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly kind: 'tool_terminal';
      readonly runId: string;
      readonly parentRunId?: string;
      readonly emittedAt: number;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status: 'success' | 'error';
    }
  | ({
      readonly kind: 'command_terminal';
      readonly runId: string;
      readonly emittedAt: number;
      readonly toolCallId: string;
      readonly commandExecutionId: string;
      readonly processExit:
        | { readonly status: 'not_started' }
        | {
            readonly status: 'observed';
            readonly exitCode: number | null;
            readonly signal: string | null;
          }
        | {
            readonly status: 'unavailable';
            readonly reason: 'runtime_lost' | 'platform_not_reported';
          };
    } & (
      | {
          readonly outcome: 'execution_ended';
          readonly terminationCause: 'natural_exit' | 'user_cancelled' | 'hard_timeout' | 'owner_ended';
        }
      | {
          readonly outcome: 'runtime_failure';
          readonly runtimeFailureCode: string;
        }
    ));

export interface ExecutionAuditEventPort {
  listByConversation(conversationId: string): Promise<readonly ExecutionAuditEventFact[]>;
}

export interface ExecutionAuditTokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokensReported?: number;
  readonly reasoningTokensReported?: number;
  readonly cacheReadTokensReported?: number;
  readonly cacheWriteTokensReported?: number;
}

export interface ExecutionAuditModelSummary {
  readonly modelId: string;
  readonly calls: number;
  readonly durationMs: number;
  readonly providerActualCalls: number;
  readonly estimateCalls: number;
  readonly missingUsageCalls: number;
  readonly actualTokens: ExecutionAuditTokenTotals;
}

export interface ExecutionAuditToolSummary {
  readonly toolName: string;
  readonly calls: number;
  readonly failedCalls: number;
  readonly durationMs: number;
  readonly errorCodes: readonly string[];
}

export type ExecutionAuditContextCompactionRecord = Extract<
  ExecutionAuditTelemetryRecord,
  { kind: 'context_compaction' }
>;

export interface ExecutionAuditContextCompactionRunSummary {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly observations: number;
  readonly attempts: number;
  readonly completed: number;
  readonly failed: number;
  readonly insufficient: number;
  readonly aborted: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly maxCompactionsPerRun: number;
  readonly compactionInputTokensReported?: number;
  readonly summaryOutputTokensReported?: number;
  readonly releasedTokensReported?: number;
  readonly providerActualCalls: number;
  readonly estimateCalls: number;
  readonly missingUsageCalls: number;
  readonly actualTokens: ExecutionAuditTokenTotals;
  readonly events: readonly ExecutionAuditContextCompactionRecord[];
}

export interface ExecutionAuditRunLifecycleSummary {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly terminalObservations: number;
  readonly phase: 'completed' | 'failed' | 'cancelled';
  readonly stepsUsed: number;
  readonly maxSteps: number;
  readonly terminalReason: ExecutionAuditRunTerminalReason;
  readonly emittedAt: number;
}

export type ExecutionAuditToolPairingStatus =
  | 'paired'
  | 'decision_missing'
  | 'terminal_missing'
  | 'duplicate_terminal';

export interface ExecutionAuditToolPairingRecord {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly pairingStatus: ExecutionAuditToolPairingStatus;
  readonly decisionCount: number;
  readonly terminalCount: number;
  readonly terminalStatus?: 'success' | 'error';
  readonly nameConsistent: boolean;
}

interface ExecutionAuditCommandTerminalSummaryBase {
  readonly runId: string;
  readonly toolCallId: string;
  readonly commandExecutionId: string;
  readonly terminalObservations: number;
  readonly processExit: Extract<ExecutionAuditEventFact, { kind: 'command_terminal' }>['processExit'];
  readonly emittedAt: number;
}

export type ExecutionAuditCommandTerminalSummary = ExecutionAuditCommandTerminalSummaryBase & (
  | {
      readonly outcome: 'execution_ended';
      readonly terminationCause: 'natural_exit' | 'user_cancelled' | 'hard_timeout' | 'owner_ended';
    }
  | {
      readonly outcome: 'runtime_failure';
      readonly runtimeFailureCode: string;
    }
);

export interface ExecutionAuditExport {
  readonly generatedAt: number;
  readonly runs: readonly ExecutionAuditRunRecord[];
  readonly sourceWindow: {
    readonly telemetryEvents: number;
    readonly earliestTelemetryAt?: number;
    readonly latestTelemetryAt?: number;
    readonly eventFacts: number;
  };
  readonly llm: {
    readonly calls: number;
    readonly durationMs: number;
    readonly providerActualCalls: number;
    readonly estimateCalls: number;
    readonly missingUsageCalls: number;
    readonly actualTokens: ExecutionAuditTokenTotals;
    readonly byModel: readonly ExecutionAuditModelSummary[];
  };
  readonly tools: {
    readonly calls: number;
    readonly failedCalls: number;
    readonly durationMs: number;
    readonly byTool: readonly ExecutionAuditToolSummary[];
  };
  readonly toolPairing: {
    readonly complete: boolean;
    readonly paired: number;
    readonly decisionMissing: number;
    readonly terminalMissing: number;
    readonly duplicateTerminal: number;
    readonly nameMismatches: number;
    readonly records: readonly ExecutionAuditToolPairingRecord[];
  };
  readonly commands: {
    readonly executions: number;
    readonly terminalObservations: number;
    readonly nonZeroExitExecutions: number;
    readonly runtimeFailureExecutions: number;
    readonly byExecution: readonly ExecutionAuditCommandTerminalSummary[];
  };
  readonly contextCompaction: {
    readonly observations: number;
    readonly attempts: number;
    readonly completed: number;
    readonly failed: number;
    readonly insufficient: number;
    readonly aborted: number;
    readonly skipped: number;
    readonly durationMs: number;
    readonly compactionInputTokensReported?: number;
    readonly summaryOutputTokensReported?: number;
    readonly releasedTokensReported?: number;
    readonly providerActualCalls: number;
    readonly estimateCalls: number;
    readonly missingUsageCalls: number;
    readonly actualTokens: ExecutionAuditTokenTotals;
    readonly byRun: readonly ExecutionAuditContextCompactionRunSummary[];
  };
  readonly runLifecycle: {
    readonly byRun: readonly ExecutionAuditRunLifecycleSummary[];
  };
}

export interface ExecutionAuditExportUseCase {
  export(request: {
    readonly conversationId: string;
    readonly runId?: string;
  }): Promise<ExecutionAuditExport | null>;
}

export interface ExecutionAuditExportPorts {
  readonly runs: ExecutionAuditRunPort;
  readonly telemetry: ExecutionAuditTelemetryPort;
  readonly events: ExecutionAuditEventPort;
  readonly now: () => number;
}
