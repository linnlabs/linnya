import {
  ContextCompactionError,
  buildContextCompactionTelemetryEvent,
} from '../../features/context-compaction';
import { CONTEXT_COMPACTION_FAILED_ERROR_CODE } from '../../../../contracts';
import { defineTickStage, type TickStage } from '../types';

/** admission 通过后，按既有 UI 顺序提交唯一 durable history_summary。 */
export function createCommitContextCompactionStage(): TickStage {
  return defineTickStage({
    id: 'commit_context_compaction',
    reads: [
      'pendingContextCompaction',
      'signal',
      'eventHandler',
      'runtimeEventCommitPort',
      'summarizationCallbacks',
      'executorLocal',
      'executorLocalPatch',
      'telemetry',
      'input',
      'conversationId',
      'turnId',
    ],
    writes: ['pendingContextCompaction', 'executorLocalPatch'],
    async run(ctx) {
      const pending = ctx.pendingContextCompaction;
      if (!pending) return;
      const runState = ctx.executorLocalPatch?.contextCompaction
        ?? ctx.executorLocal?.contextCompaction;
      const attemptCount = runState?.attemptCount ?? pending.attemptIndex;
      const previousCommittedCount = runState?.committedCount ?? 0;
      const telemetryBase = {
        modelId: pending.modelId,
        policy: pending.policy,
        plan: pending.plan,
        usageBefore: pending.usageBefore,
        compactionIndex: pending.attemptIndex,
        generationAttempted: true,
        durationMs: pending.compactionDurationMs,
        compactionInputTokens: pending.compactionInputTokens,
        afterTokens: pending.usageAfter.used_tokens,
        summaryOutputTokens: pending.summaryTokenCount,
        compressionRatio: pending.compressionRatio,
        ...(pending.canonicalUsage ? { canonicalUsage: pending.canonicalUsage } : {}),
        forcedPhaseRecovery: pending.forcedPhaseRecovery,
        targetUnreachable: pending.targetUnreachable,
        scope: {
          conversationId: ctx.conversationId,
          runId: ctx.input.toolContext?.runId,
          parentRunId: ctx.input.toolContext?.parentRunId,
          turnId: ctx.turnId,
        },
      };
      if (ctx.signal?.aborted === true) {
        const abortError = new Error('Context compaction aborted before durable commit.');
        abortError.name = 'AbortError';
        ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
          ...telemetryBase,
          outcome: 'aborted',
          errorCode: CONTEXT_COMPACTION_FAILED_ERROR_CODE,
          failureReason: abortError.name,
        }));
        ctx.summarizationCallbacks?.onSummarizationError?.(abortError);
        throw abortError;
      }
      if (!ctx.eventHandler || !ctx.runtimeEventCommitPort) {
        const error = new ContextCompactionError(
          CONTEXT_COMPACTION_FAILED_ERROR_CODE,
          'CONTEXT_COMPACTION_COMMIT_FAILED',
          '上下文压缩缺少 RuntimeEvent sink 或 durable commit port。',
        );
        ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
          ...telemetryBase,
          outcome: 'failed',
          errorCode: error.code,
          failureReason: error.reason,
        }));
        throw error;
      }

      try {
        await ctx.runtimeEventCommitPort(
          pending.event,
          'GraphAgentExecutor.context_compaction',
        );
      } catch (error) {
        const commitError = new ContextCompactionError(
          CONTEXT_COMPACTION_FAILED_ERROR_CODE,
          'CONTEXT_COMPACTION_COMMIT_FAILED',
          'history_summary 未能完成持久化提交，主模型调用已阻止。',
          { cause: error },
        );
        ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
          ...telemetryBase,
          outcome: 'failed',
          errorCode: commitError.code,
          failureReason: commitError.reason,
        }));
        try {
          ctx.summarizationCallbacks?.onSummarizationError?.(commitError);
        } catch {
          // realtime transport 已失败时不能让 presentation 异常覆盖 durable commit 根因。
        }
        throw commitError;
      }

      // durable commit 是不可回滚的事实边界。成功后再按 Renderer
      // 既有合同发 end → history_summary；post-commit 发布异常不得伪装成压缩回滚。
      ctx.telemetry.emit(buildContextCompactionTelemetryEvent({
        ...telemetryBase,
        outcome: 'completed',
      }));
      ctx.summarizationCallbacks?.onSummarizationEnd?.({
        originalMessageCount: pending.event.original_message_count,
        summaryTokenCount: pending.summaryTokenCount,
        summaryEvent: pending.event,
      });
      ctx.eventHandler(pending.event);
      return {
        pendingContextCompaction: undefined,
        executorLocalPatch: {
          ...(ctx.executorLocalPatch ?? {}),
          contextCompaction: {
            attemptCount,
            committedCount: previousCommittedCount + 1,
            lastCommittedFingerprint: pending.plan.fingerprint,
          },
        },
      };
    },
  });
}
