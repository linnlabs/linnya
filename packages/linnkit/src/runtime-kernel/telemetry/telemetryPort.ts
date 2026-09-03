import type { NormalizedLlmUsage } from '../../shared/llmTelemetryContext';
import type {
  CanonicalLlmUsage,
  ContextCompactionErrorCode,
  ContextBuildTokenEstimate,
  ContextComponentTokenLedgerEntry,
  ContextTokenComponent,
  LlmUsageTokenLedgerEntry,
} from '../../contracts';
import type { TelemetryEventKind } from './telemetryEvents';

export type TelemetryScope = {
  conversationId?: string;
  runId?: string;
  parentRunId?: string;
  turnId?: string;
  stepId?: string;
};

export type ContextCompactionTelemetryOutcome =
  | 'skipped'
  | 'completed'
  | 'failed'
  | 'insufficient'
  | 'aborted';

export type ContextCompactionSuppressedReason =
  | 'disabled'
  | 'below_trigger'
  | 'no_replaceable_range'
  | 'forced_final_answer'
  | 'forced_tools'
  | 'max_compactions_reached'
  | 'duplicate_plan_fingerprint';

export type RunLifecycleTerminalReason =
  | 'completed'
  | 'awaiting_user'
  | 'step_budget_forced_completion'
  | 'step_budget_exhausted'
  | 'capacity_failed'
  | 'failed'
  | 'cancelled';

export type TelemetryEvent =
  | {
      kind: Extract<TelemetryEventKind, 'llm_call'>;
      modelId: string;
      stream: boolean;
      durationMs: number;
      usage?: NormalizedLlmUsage;
      canonicalUsage?: CanonicalLlmUsage;
      tokenLedgerEntry?: LlmUsageTokenLedgerEntry;
      phase?: 'main' | 'context-internal';
      purpose?: string;
      scope: TelemetryScope;
    }
  | {
      kind: Extract<TelemetryEventKind, 'tool_call'>;
      toolName: string;
      durationMs: number;
      ok: boolean;
      errorCode?: string;
      scope: TelemetryScope;
    }
  | {
      kind: Extract<TelemetryEventKind, 'context_build'>;
      modelId: string;
      tokenEstimate: ContextBuildTokenEstimate;
      tokenComponents?: ContextTokenComponent[];
      tokenLedgerEntry?: ContextComponentTokenLedgerEntry;
      scope: TelemetryScope;
    }
  | {
      kind: Extract<TelemetryEventKind, 'context_compaction'>;
      modelId: string;
      durationMs: number;
      compactionIndex: number;
      maxCompactionsPerRun: number;
      /** 是否已经向当前锁定的 Provider 发出摘要生成请求。 */
      generationAttempted: boolean;
      triggerRatio: number;
      targetRatio: number;
      beforeTokens: number;
      inputBudgetTokens: number;
      compactionInputTokens?: number;
      afterTokens?: number;
      replacedMessageCount: number;
      replacedToolGroupCount: number;
      keptToolGroupCount: number;
      summaryOutputTokens?: number;
      /** 原始摘要 / 被替换区段 token 比率；无效压缩可大于等于 1。 */
      compressionRatio?: number;
      canonicalUsage?: CanonicalLlmUsage;
      outcome: ContextCompactionTelemetryOutcome;
      suppressedReason?: ContextCompactionSuppressedReason;
      forcedPhaseRecovery: boolean;
      targetUnreachable?: boolean;
      errorCode?: ContextCompactionErrorCode;
      failureReason?: string;
      scope: TelemetryScope;
    }
  | {
      kind: Extract<TelemetryEventKind, 'graph_node'>;
      nodeId: string;
      durationMs: number;
      scope: TelemetryScope;
    }
  | {
      kind: Extract<TelemetryEventKind, 'run_lifecycle'>;
      runId: string;
      phase: 'spawned';
      scope: TelemetryScope;
    }
  | {
      kind: Extract<TelemetryEventKind, 'run_lifecycle'>;
      runId: string;
      phase: 'completed' | 'failed' | 'cancelled';
      stepsUsed: number;
      maxSteps: number;
      terminalReason: RunLifecycleTerminalReason;
      scope: TelemetryScope;
    };

export interface TelemetryPort {
  emit(event: TelemetryEvent): void;
  flush?(): Promise<void>;
}
