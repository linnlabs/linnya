import type { LlmCaller } from '../../../llm/caller';
import type { ModelCatalogLike } from '../../../llm/modelCatalog';
import type { GraphExecutorContextBuilder } from '../../executorContextBuilder';
import type { PromptUsageMeasurer } from '../../orchestration/measurePromptUsage';
import {
  ContextCompactionError,
  buildContextCompactionTelemetryEvent,
  evaluateContextCompaction,
  executeContextCompaction,
} from '../../features/context-compaction';
import {
  CONTEXT_COMPACTION_FAILED_ERROR_CODE,
  CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
  toSerializableJsonRecord,
} from '../../../../contracts';
import { defineTickStage, type TickStage } from '../types';

export interface CompactContextStageDependencies {
  llmCaller: Partial<Pick<LlmCaller, 'call'>>;
  modelCatalog: Pick<ModelCatalogLike, 'getModelById'>;
  contextBuilder: GraphExecutorContextBuilder;
  promptUsageMeasurer: PromptUsageMeasurer;
}

export function createCompactContextStage(
  dependencies: CompactContextStageDependencies,
): TickStage {
  return defineTickStage({
    id: 'compact_context',
    reads: [
      'input',
      'request',
      'history',
      'signal',
      'executorLocal',
      'executorLocalPatch',
      'eventHandler',
      'runtimeEventCommitPort',
      'summarizationCallbacks',
      'modelId',
      'toolDefinitionTokens',
      'llmOptions',
      'promptBudget',
      'promptUsageMeasurementPolicy',
      'promptUsageCandidate',
      'llmMessages',
      'imageInputAdmissionEvidence',
      'contextCompactionCandidate',
      'contextCompactionPolicy',
      'conversationId',
      'turnId',
      'telemetry',
    ],
    writes: [
      'llmMessages',
      'imageInputAdmissionEvidence',
      'outputProcessor',
      'contextTrace',
      'promptBudget',
      'promptUsageMeasurementPolicy',
      'promptUsageCandidate',
      'contextCompactionCandidate',
      'contextCompactionPolicy',
      'pendingContextCompaction',
      'executorLocalPatch',
      'llmOptions',
      'systemReminderHitRuleIds',
    ],
    async run(ctx) {
      if (!ctx.promptUsageCandidate) return;
      const policy = ctx.contextCompactionPolicy ?? ctx.contextCompactionCandidate?.policy;
      if (!policy) return;
      const runState = ctx.executorLocalPatch?.contextCompaction
        ?? ctx.executorLocal?.contextCompaction;
      const attemptCount = runState?.attemptCount ?? 0;
      const committedCount = runState?.committedCount ?? 0;
      const decision = evaluateContextCompaction({
        policy,
        promptUsage: ctx.promptUsageCandidate,
        phase: ctx.executorLocal?.phase,
        attemptCount,
        lastCommittedFingerprint: runState?.lastCommittedFingerprint,
        candidateFingerprint: ctx.contextCompactionCandidate?.plan.fingerprint,
      });
      const compactionIndex = attemptCount + 1;
      const telemetryScope = {
        conversationId: ctx.conversationId,
        runId: ctx.input.toolContext?.runId,
        parentRunId: ctx.input.toolContext?.parentRunId,
        turnId: ctx.turnId,
      };
      if (decision.kind === 'skip') {
        if (decision.reason !== 'disabled' && decision.reason !== 'below_trigger') {
          ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
            modelId: ctx.modelId,
            policy,
            plan: ctx.contextCompactionCandidate?.plan,
            usageBefore: ctx.promptUsageCandidate,
            compactionIndex,
            generationAttempted: false,
            durationMs: 0,
            outcome: 'skipped',
            suppressedReason: decision.reason,
            scope: telemetryScope,
          }));
        }
        return;
      }
      if (decision.kind === 'blocked') {
        const error = new ContextCompactionError(
          CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
          blockedDecisionReason(decision.reason),
          `主 Prompt 已超限，但上下文压缩不可执行：${decision.reason}`,
        );
        ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
          modelId: ctx.modelId,
          policy,
          plan: ctx.contextCompactionCandidate?.plan,
          usageBefore: ctx.promptUsageCandidate,
          compactionIndex,
          generationAttempted: false,
          durationMs: 0,
          outcome: 'insufficient',
          errorCode: error.code,
          failureReason: error.reason,
          scope: telemetryScope,
        }));
        throw error;
      }
      if (!ctx.contextCompactionCandidate) {
        throw new ContextCompactionError(
          CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
          'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
          '主 Prompt 已达到压缩条件，但没有可替换的完整历史区段。',
        );
      }
      const compactionLlmCaller = dependencies.llmCaller;
      if (
        !ctx.promptBudget
        || !ctx.promptUsageMeasurementPolicy
        || !hasContextCompactionCall(compactionLlmCaller)
      ) {
        const error = new ContextCompactionError(
          CONTEXT_COMPACTION_FAILED_ERROR_CODE,
          'CONTEXT_COMPACTION_UNAVAILABLE',
          '上下文压缩缺少 LLM caller、Prompt 预算或计量策略。',
        );
        ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
          modelId: ctx.modelId,
          policy,
          plan: ctx.contextCompactionCandidate.plan,
          usageBefore: ctx.promptUsageCandidate,
          compactionIndex,
          generationAttempted: false,
          durationMs: 0,
          outcome: 'failed',
          errorCode: error.code,
          failureReason: error.reason,
          forcedPhaseRecovery: decision.forcedPhaseRecovery,
          scope: telemetryScope,
        }));
        if (isHardLimitExceeded(ctx.promptUsageCandidate)) throw error;
        return;
      }
      if (!ctx.eventHandler || !ctx.runtimeEventCommitPort) {
        const error = new ContextCompactionError(
          CONTEXT_COMPACTION_FAILED_ERROR_CODE,
          'CONTEXT_COMPACTION_COMMIT_FAILED',
          '上下文压缩缺少 RuntimeEvent sink 或 durable commit port。',
        );
        ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
          modelId: ctx.modelId,
          policy,
          plan: ctx.contextCompactionCandidate.plan,
          usageBefore: ctx.promptUsageCandidate,
          compactionIndex,
          generationAttempted: false,
          durationMs: 0,
          outcome: 'failed',
          errorCode: error.code,
          failureReason: error.reason,
          forcedPhaseRecovery: decision.forcedPhaseRecovery,
          scope: telemetryScope,
        }));
        if (isHardLimitExceeded(ctx.promptUsageCandidate)) throw error;
        return;
      }

      const compactionStartedAt = Date.now();
      const imageInputTokens = ctx.imageInputAdmissionEvidence?.attachments.reduce(
        (total, attachment) => total + attachment.estimatedTokens,
        0,
      ) ?? 0;
      let generationAttempted = false;
      const attemptState = {
        attemptCount: compactionIndex,
        committedCount,
        ...(runState?.lastCommittedFingerprint
          ? { lastCommittedFingerprint: runState.lastCommittedFingerprint }
          : {}),
      };
      ctx.summarizationCallbacks?.onSummarizationStart?.();
      try {
        const result = await executeContextCompaction(
          {
            // 保留 caller 实例，避免把类方法解构后丢失 Provider registry 等实例状态。
            llmCaller: compactionLlmCaller,
            contextBuilder: dependencies.contextBuilder,
            promptUsageMeasurer: dependencies.promptUsageMeasurer,
          },
          {
            buildInput: {
              request: ctx.request,
              history: ctx.history,
              modelId: ctx.modelId,
              toolDefinitionTokens: ctx.toolDefinitionTokens,
              signal: ctx.signal,
            },
            candidate: ctx.contextCompactionCandidate,
            modelId: ctx.modelId,
            routeMaxOutputTokens:
              dependencies.modelCatalog.getModelById(ctx.modelId)?.inference_route
                ?.max_output_tokens ?? ctx.promptBudget.outputLimitTokens,
            mainLlmOptions: ctx.llmOptions,
            llmMessages: ctx.llmMessages,
            imageInputAdmissionEvidence: ctx.imageInputAdmissionEvidence,
            imageInputTokens,
            promptBudget: ctx.promptBudget,
            promptUsageMeasurementPolicy: ctx.promptUsageMeasurementPolicy,
            originalPromptUsage: ctx.promptUsageCandidate,
            request: ctx.request,
            history: ctx.history,
            executorLocal: ctx.executorLocal,
            conversationId: ctx.conversationId,
            turnId: ctx.turnId,
            forcedPhaseRecovery: decision.forcedPhaseRecovery,
            signal: ctx.signal,
            telemetry: ctx.telemetry,
            onGenerationAttempt: () => {
              generationAttempted = true;
            },
            runId: ctx.input.toolContext?.runId,
            parentRunId: ctx.input.toolContext?.parentRunId,
          },
        );
        return {
          llmMessages: result.llmMessages,
          imageInputAdmissionEvidence: result.imageInputAdmissionEvidence,
          outputProcessor: result.outputProcessor,
          contextTrace: toSerializableJsonRecord(result.contextTrace),
          promptBudget: result.promptBudget,
          promptUsageMeasurementPolicy: result.promptUsageMeasurementPolicy,
          promptUsageCandidate: result.promptUsageCandidate,
          contextCompactionCandidate: result.contextCompactionCandidate,
          contextCompactionPolicy: result.contextCompactionPolicy,
          pendingContextCompaction: {
            ...result.pendingContextCompaction,
            attemptIndex: compactionIndex,
          },
          executorLocalPatch: {
            contextCompaction: attemptState,
          },
          llmOptions: result.llmOptions,
          systemReminderHitRuleIds: result.systemReminderHitRuleIds,
        };
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        const compactionError = normalized instanceof ContextCompactionError
          ? normalized
          : undefined;
        // Provider 会保留 AbortError 名称，即使外层 signal 由另一层控制器管理。
        // 终止是执行语义，不能被软阈值的“原 Prompt 仍合法”分支吞掉。
        const aborted = normalized.name === 'AbortError' || ctx.signal?.aborted === true;
        ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
          modelId: ctx.modelId,
          policy,
          plan: ctx.contextCompactionCandidate.plan,
          usageBefore: ctx.promptUsageCandidate,
          compactionIndex,
          generationAttempted,
          durationMs: compactionError?.metrics?.durationMs
            ?? Date.now() - compactionStartedAt,
          ...(compactionError?.metrics?.compactionInputTokens !== undefined
            ? { compactionInputTokens: compactionError.metrics.compactionInputTokens }
            : {}),
          ...(compactionError?.metrics?.afterTokens !== undefined
            ? { afterTokens: compactionError.metrics.afterTokens }
            : {}),
          ...(compactionError?.metrics?.summaryOutputTokens !== undefined
            ? { summaryOutputTokens: compactionError.metrics.summaryOutputTokens }
            : {}),
          ...(compactionError?.metrics?.compressionRatio !== undefined
            ? { compressionRatio: compactionError.metrics.compressionRatio }
            : {}),
          ...(compactionError?.metrics?.canonicalUsage
            ? { canonicalUsage: compactionError.metrics.canonicalUsage }
            : {}),
          ...(compactionError?.metrics?.targetUnreachable !== undefined
            ? { targetUnreachable: compactionError.metrics.targetUnreachable }
            : {}),
          outcome: aborted
            ? 'aborted'
            : compactionError?.code === CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE
              ? 'insufficient'
              : 'failed',
          errorCode: compactionError?.code ?? CONTEXT_COMPACTION_FAILED_ERROR_CODE,
          failureReason: compactionError?.reason ?? normalized.name,
          forcedPhaseRecovery: decision.forcedPhaseRecovery,
          scope: telemetryScope,
        }));
        ctx.summarizationCallbacks?.onSummarizationError?.(normalized);
        if (aborted || isHardLimitExceeded(ctx.promptUsageCandidate)) throw normalized;
        return generationAttempted
          ? { executorLocalPatch: { contextCompaction: attemptState } }
          : undefined;
      }
    },
  });
}

function hasContextCompactionCall(
  caller: Partial<Pick<LlmCaller, 'call'>>,
): caller is Pick<LlmCaller, 'call'> {
  return typeof caller.call === 'function';
}

function blockedDecisionReason(
  reason:
    | 'no_replaceable_range'
    | 'max_compactions_reached'
    | 'duplicate_plan_fingerprint',
):
  | 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE'
  | 'CONTEXT_COMPACTION_LIMIT_REACHED'
  | 'CONTEXT_COMPACTION_DUPLICATE_PLAN' {
  switch (reason) {
    case 'no_replaceable_range':
      return 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE';
    case 'max_compactions_reached':
      return 'CONTEXT_COMPACTION_LIMIT_REACHED';
    case 'duplicate_plan_fingerprint':
      return 'CONTEXT_COMPACTION_DUPLICATE_PLAN';
  }
}

function isHardLimitExceeded(usage: {
  used_tokens: number;
  input_budget_tokens: number;
}): boolean {
  return usage.used_tokens > usage.input_budget_tokens;
}
