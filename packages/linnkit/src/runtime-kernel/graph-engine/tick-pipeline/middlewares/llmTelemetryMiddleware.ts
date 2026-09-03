import { normalizedUsageFromCanonical } from '../../../../shared/llmTelemetryContext';
import { extractResponseText, resolveCanonicalUsage } from '../helpers';
import type { TickAroundMiddleware } from '../types';

export const llmTelemetryMiddleware: TickAroundMiddleware = async (ctx, stage, next) => {
  await next();

  if (stage.id !== 'execute_llm' || ctx.llmCallStartedAt === undefined || ctx.llmCallDurationMs === undefined) {
    return;
  }

  const canonicalUsageFromHost = resolveCanonicalUsage(ctx.llmResp);
  const normalizedUsageFromProvider = canonicalUsageFromHost
    ? normalizedUsageFromCanonical(canonicalUsageFromHost)
    : undefined;
  const respText = extractResponseText(ctx.llmResp);
  const normalizedUsage =
    normalizedUsageFromProvider ??
    (() => {
      try {
        const promptTokens = ctx.llmMessages.reduce(
          (total, message) => total + ctx.tokenizer.estimateMessage(message, ctx.modelId),
          0,
        );
        const completionTokens = ctx.tokenizer.estimateText(respText, ctx.modelId);
        return normalizedUsageFromCanonical({
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          totalTokens: promptTokens + completionTokens,
          source: 'local-estimate',
          confidence: 'estimate',
        });
      } catch {
        return undefined;
      }
    })();

  // Q-M13：kernel 只写显式 TelemetryPort；ALS 聚合若仍需要，应由 host adapter 在 Port 外层完成。
  ctx.telemetry.emit({
    kind: 'llm_call',
    modelId: ctx.modelId,
    stream: ctx.input.stream === true,
    durationMs: ctx.llmCallDurationMs,
    usage: normalizedUsage,
    ...(normalizedUsage?.canonicalUsage ? { canonicalUsage: normalizedUsage.canonicalUsage } : {}),
    scope: {
      conversationId: ctx.conversationId || undefined,
      turnId: ctx.turnId,
      runId: ctx.input.toolContext?.runId ?? ctx.turnId,
      parentRunId: ctx.input.toolContext?.parentRunId,
    },
  });
};
