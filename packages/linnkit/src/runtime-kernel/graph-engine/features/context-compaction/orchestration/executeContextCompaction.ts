import type { LlmCaller } from '../../../../llm/caller';
import type { LlmCallOptions } from '../../../../llm/caller';
import type {
  ImageInputAdmissionEvidence,
  LlmRequestMessage,
} from '../../../../../ports';
import type {
  GraphExecutorContextBuilder,
  GraphExecutorContextBuildInput,
  GraphContextCompactionCandidate,
} from '../../../executorContextBuilder';
import type { PromptUsageMeasurer } from '../../../orchestration/measurePromptUsage';
import { evaluatePrimaryPromptCapacity } from '../../../functions/evaluatePrimaryPromptCapacity';
import { applyTickSystemReminder } from '../../../functions/applyTickSystemReminder';
import type {
  CanonicalLlmUsage,
  ContextUsageSnapshot,
  HistorySummaryEvent,
  PromptUsageMeasurementPolicy,
} from '../../../../../contracts';
import {
  CONTEXT_COMPACTION_FAILED_ERROR_CODE,
  CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
  generateRuntimeEventId,
} from '../../../../../contracts';
import type { EffectivePromptBudget } from '../../../functions/resolveEffectivePromptBudget';
import type { TelemetryPort } from '../../../../telemetry/telemetryPort';
import { normalizedUsageFromCanonical } from '../../../../../shared/llmTelemetryContext';
import { buildContextCompactionRequest } from '../functions/buildContextCompactionRequest';
import { ContextCompactionError } from '../definitions/contextCompactionError';
import type { ExecutorLocalState } from '../../../types';

export interface ExecuteContextCompactionInput {
  buildInput: GraphExecutorContextBuildInput;
  candidate: GraphContextCompactionCandidate;
  modelId: string;
  /** 当前正式 route 的输出硬上限；不能被 Agent 主回答预留反向收窄。 */
  routeMaxOutputTokens: number;
  mainLlmOptions: LlmCallOptions;
  /** 普通 Reminder 已注入并完成计量的本 tick 完整 Prompt。 */
  llmMessages: readonly LlmRequestMessage[];
  /** Context Manager 为当前 Prompt 生成的图片证据；瞬态 Reminder 不改变附件位置。 */
  imageInputAdmissionEvidence?: ImageInputAdmissionEvidence;
  imageInputTokens: number;
  promptBudget: EffectivePromptBudget;
  promptUsageMeasurementPolicy: PromptUsageMeasurementPolicy;
  originalPromptUsage: ContextUsageSnapshot;
  request: GraphExecutorContextBuildInput['request'];
  history: GraphExecutorContextBuildInput['history'];
  executorLocal?: ExecutorLocalState;
  conversationId: string;
  turnId: string;
  forcedPhaseRecovery: boolean;
  signal?: AbortSignal;
  telemetry: TelemetryPort;
  /** 只在即将发起真实压缩模型调用时登记 run-local attempt。 */
  onGenerationAttempt: () => void;
  runId?: string;
  parentRunId?: string;
}

export interface ExecuteContextCompactionResult {
  llmMessages: Awaited<ReturnType<GraphExecutorContextBuilder['build']>>['llmMessages'];
  imageInputAdmissionEvidence: Awaited<ReturnType<GraphExecutorContextBuilder['build']>>['imageInputAdmissionEvidence'];
  outputProcessor: Awaited<ReturnType<GraphExecutorContextBuilder['build']>>['outputProcessor'];
  contextTrace: Awaited<ReturnType<GraphExecutorContextBuilder['build']>>['contextTrace'];
  promptBudget: EffectivePromptBudget;
  promptUsageMeasurementPolicy: PromptUsageMeasurementPolicy;
  promptUsageCandidate: ContextUsageSnapshot;
  contextCompactionCandidate: GraphContextCompactionCandidate | undefined;
  contextCompactionPolicy: GraphContextCompactionCandidate['policy'] | undefined;
  pendingContextCompaction: {
    plan: GraphContextCompactionCandidate['plan'];
    policy: GraphContextCompactionCandidate['policy'];
    modelId: string;
    event: HistorySummaryEvent;
    compressionRatio: number;
    summaryTokenCount: number;
    compactionInputTokens: number;
    compactionDurationMs: number;
    canonicalUsage?: CanonicalLlmUsage;
    forcedPhaseRecovery: boolean;
    targetUnreachable: boolean;
    usageBefore: ContextUsageSnapshot;
    usageAfter: ContextUsageSnapshot;
  };
  llmOptions: LlmCallOptions;
  systemReminderHitRuleIds?: string[];
}

/**
 * 执行一次内部压缩调用并重建主 Prompt；不发布 summary，也不调用主模型。
 */
export async function executeContextCompaction(
  dependencies: {
    llmCaller: Pick<LlmCaller, 'call'>;
    contextBuilder: GraphExecutorContextBuilder;
    promptUsageMeasurer: PromptUsageMeasurer;
  },
  input: ExecuteContextCompactionInput,
): Promise<ExecuteContextCompactionResult> {
  const compactionStartedAt = Date.now();
  if (!dependencies.contextBuilder.applyCompaction) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_UNAVAILABLE',
      'Context Builder 产生了压缩计划，但未实现 applyCompaction。',
    );
  }

  const messages = buildContextCompactionRequest(
    input.llmMessages,
    input.candidate.reminder,
  );
  const maxOutputTokens = Math.min(
    input.candidate.policy.maxOutputTokens,
    input.routeMaxOutputTokens,
  );
  const compactionOptions = buildCompactionLlmOptions({
    mainOptions: input.mainLlmOptions,
    maxOutputTokens,
  });
  const compactionPromptBudget = buildCompactionPromptBudget(
    input.promptBudget,
    maxOutputTokens,
  );
  const compactionPromptUsage = await dependencies.promptUsageMeasurer({
    budgetModelId: input.modelId,
    servedModelId: input.modelId,
    messages,
    llmOptions: compactionOptions,
    promptBudget: compactionPromptBudget,
    measurementPolicy: input.promptUsageMeasurementPolicy,
    imageInputTokens: input.imageInputTokens,
    signal: input.signal,
  });
  if (!evaluatePrimaryPromptCapacity(compactionPromptUsage).admitted) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_GENERATION_FAILED',
      '压缩请求本身超过当前模型可接纳的输入预算。',
    );
  }

  const llmStartedAt = Date.now();
  let response: Awaited<ReturnType<LlmCaller['call']>>;
  try {
    input.onGenerationAttempt();
    response = await dependencies.llmCaller.call(
      input.modelId,
      messages,
      compactionOptions,
      input.signal,
      { imageInputAdmissionEvidence: input.imageInputAdmissionEvidence },
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    if (input.signal?.aborted === true) {
      const abortError = new Error('Context compaction aborted.');
      abortError.name = 'AbortError';
      throw abortError;
    }
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_GENERATION_FAILED',
      '上下文压缩模型调用失败。',
      { cause: error },
    );
  }
  input.telemetry.emit({
    kind: 'llm_call',
    modelId: input.modelId,
    stream: false,
    durationMs: Date.now() - llmStartedAt,
    ...(typeof response === 'object' && response.canonicalUsage
      ? {
          canonicalUsage: response.canonicalUsage,
          usage: normalizedUsageFromCanonical(response.canonicalUsage),
        }
      : {}),
    phase: 'context-internal',
    purpose: 'context_compaction',
    scope: {
      conversationId: input.conversationId,
      runId: input.runId,
      parentRunId: input.parentRunId,
      turnId: input.turnId,
    },
  });
  const failureMetrics = (extra: {
    readonly afterTokens?: number;
    readonly summaryOutputTokens?: number;
    readonly compressionRatio?: number;
    readonly targetUnreachable?: boolean;
  } = {}) => ({
    durationMs: Date.now() - compactionStartedAt,
    compactionInputTokens: compactionPromptUsage.used_tokens,
    ...(typeof response === 'object' && response.canonicalUsage
      ? { canonicalUsage: response.canonicalUsage }
      : {}),
    ...extra,
  });
  if (typeof response === 'object' && (response.tool_calls?.length ?? 0) > 0) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_TOOL_CALL_REJECTED',
      '上下文压缩响应包含工具调用，已拒绝该结果。',
      { metrics: failureMetrics() },
    );
  }
  const checkpointContent = typeof response === 'string' ? response : response.content;
  let applyResult: Awaited<ReturnType<NonNullable<GraphExecutorContextBuilder['applyCompaction']>>>;
  try {
    applyResult = await dependencies.contextBuilder.applyCompaction({
      ...input.buildInput,
      plan: input.candidate.plan,
      checkpointContent,
      summaryId: generateRuntimeEventId(),
      conversationId: input.conversationId,
      turnId: input.turnId,
      timestamp: Date.now(),
      maxOutputTokens,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_REBUILD_FAILED',
      '上下文压缩结果重建失败。',
      { cause: error, metrics: failureMetrics() },
    );
  }
  if (applyResult.kind === 'invalid') {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_INVALID_OUTPUT',
      `上下文压缩结果未通过校验：${applyResult.reason}`,
      {
        metrics: failureMetrics({
          ...(applyResult.tokenEstimate !== undefined
            ? { summaryOutputTokens: applyResult.tokenEstimate }
            : {}),
        }),
      },
    );
  }
  if (applyResult.kind === 'ineffective') {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
      'CONTEXT_COMPACTION_INEFFECTIVE',
      `上下文压缩无收益：ratio=${applyResult.compressionRatio}`,
      {
        metrics: failureMetrics({
          summaryOutputTokens: applyResult.summaryTokenEstimate,
          compressionRatio: applyResult.compressionRatio,
        }),
      },
    );
  }

  const rebuilt = applyResult.rebuiltContext;
  if (!rebuilt.promptBudget || !rebuilt.promptUsageMeasurementPolicy) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_UNAVAILABLE',
      '重建上下文缺少 Prompt 预算或计量策略。',
      { metrics: failureMetrics({ summaryOutputTokens: applyResult.summaryTokenEstimate }) },
    );
  }
  let reminderResult: ReturnType<typeof applyTickSystemReminder>;
  try {
    reminderResult = applyTickSystemReminder({
      llmMessages: rebuilt.llmMessages,
      request: input.request,
      history: input.history,
      executorLocal: input.executorLocal,
    });
  } catch (error) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_REBUILD_FAILED',
      '压缩后的主 Prompt reminder 重建失败。',
      {
        cause: error,
        metrics: failureMetrics({ summaryOutputTokens: applyResult.summaryTokenEstimate }),
      },
    );
  }
  const rebuiltLlmOptions: LlmCallOptions = {
    ...input.mainLlmOptions,
    max_tokens: rebuilt.promptBudget.outputLimitTokens,
  };
  if (rebuilt.cachePolicy) {
    rebuiltLlmOptions.cache_policy = rebuilt.cachePolicy;
  } else {
    delete rebuiltLlmOptions.cache_policy;
  }
  let rebuiltPromptUsage: ContextUsageSnapshot;
  try {
    rebuiltPromptUsage = await dependencies.promptUsageMeasurer({
      budgetModelId: input.modelId,
      servedModelId: input.modelId,
      messages: reminderResult.llmMessages,
      llmOptions: rebuiltLlmOptions,
      promptBudget: rebuilt.promptBudget,
      measurementPolicy: rebuilt.promptUsageMeasurementPolicy,
      imageInputTokens: rebuilt.imageInputAdmissionEvidence?.attachments.reduce(
        (total, attachment) => total + attachment.estimatedTokens,
        0,
      ) ?? 0,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_FAILED_ERROR_CODE,
      'CONTEXT_COMPACTION_REBUILD_FAILED',
      '压缩后的主 Prompt 计量失败。',
      {
        cause: error,
        metrics: failureMetrics({ summaryOutputTokens: applyResult.summaryTokenEstimate }),
      },
    );
  }
  if (!evaluatePrimaryPromptCapacity(rebuiltPromptUsage).admitted) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
      'CONTEXT_COMPACTION_REBUILD_OVER_BUDGET',
      '压缩后的主 Prompt 仍超过当前模型输入预算。',
      {
        metrics: failureMetrics({
          afterTokens: rebuiltPromptUsage.used_tokens,
          summaryOutputTokens: applyResult.summaryTokenEstimate,
        }),
      },
    );
  }
  if (rebuiltPromptUsage.used_tokens >= input.originalPromptUsage.used_tokens) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
      'CONTEXT_COMPACTION_INEFFECTIVE',
      '压缩后的主 Prompt 未严格减少，拒绝提交无收益摘要。',
      {
        metrics: failureMetrics({
          afterTokens: rebuiltPromptUsage.used_tokens,
          summaryOutputTokens: applyResult.summaryTokenEstimate,
          compressionRatio: applyResult.compressionRatio,
        }),
      },
    );
  }
  const rebuiltUsageRatio =
    rebuiltPromptUsage.used_tokens / rebuiltPromptUsage.input_budget_tokens;
  if (
    rebuiltUsageRatio > input.candidate.policy.targetRatio
    && !input.candidate.plan.replaceableRangeExhausted
  ) {
    throw new ContextCompactionError(
      CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
      'CONTEXT_COMPACTION_TARGET_NOT_REACHED',
      '压缩后仍高于目标水位，且当前连续区段仍有可替换历史。',
      {
        metrics: failureMetrics({
          afterTokens: rebuiltPromptUsage.used_tokens,
          summaryOutputTokens: applyResult.summaryTokenEstimate,
          targetUnreachable: false,
        }),
      },
    );
  }

  return {
    llmMessages: reminderResult.llmMessages,
    imageInputAdmissionEvidence: rebuilt.imageInputAdmissionEvidence,
    outputProcessor: rebuilt.outputProcessor,
    contextTrace: rebuilt.contextTrace,
    promptBudget: rebuilt.promptBudget,
    promptUsageMeasurementPolicy: rebuilt.promptUsageMeasurementPolicy,
    promptUsageCandidate: rebuiltPromptUsage,
    contextCompactionCandidate: rebuilt.contextCompactionCandidate,
    contextCompactionPolicy: rebuilt.contextCompactionPolicy,
    pendingContextCompaction: {
      plan: input.candidate.plan,
      policy: input.candidate.policy,
      modelId: input.modelId,
      event: applyResult.pendingSummaryEvent,
      compressionRatio: applyResult.compressionRatio,
      summaryTokenCount: applyResult.summaryTokenEstimate,
      compactionInputTokens: compactionPromptUsage.used_tokens,
      compactionDurationMs: Date.now() - compactionStartedAt,
      ...(typeof response === 'object' && response.canonicalUsage
        ? { canonicalUsage: response.canonicalUsage }
        : {}),
      forcedPhaseRecovery: input.forcedPhaseRecovery,
      targetUnreachable: rebuiltUsageRatio > input.candidate.policy.targetRatio,
      usageBefore: input.originalPromptUsage,
      usageAfter: rebuiltPromptUsage,
    },
    llmOptions: rebuiltLlmOptions,
    systemReminderHitRuleIds: reminderResult.hitRuleIds,
  };
}

function buildCompactionLlmOptions(input: {
  mainOptions: LlmCallOptions;
  maxOutputTokens: number;
}): LlmCallOptions {
  return {
    ...(input.mainOptions.tools ? { tools: [...input.mainOptions.tools] } : {}),
    ...(input.mainOptions.cache_policy
      ? { cache_policy: input.mainOptions.cache_policy }
      : {}),
    tool_choice: 'none',
    max_tokens: input.maxOutputTokens,
    retry_policy: 'none',
    allow_model_fallback: false,
    ...(input.mainOptions.temperature !== undefined
      ? { temperature: input.mainOptions.temperature }
      : {}),
    ...(input.mainOptions.top_p !== undefined ? { top_p: input.mainOptions.top_p } : {}),
    ...(input.mainOptions.reasoning_effort !== undefined
      ? { reasoning_effort: input.mainOptions.reasoning_effort }
      : {}),
  };
}

function buildCompactionPromptBudget(
  mainBudget: EffectivePromptBudget,
  maxOutputTokens: number,
): EffectivePromptBudget {
  const inputBudgetTokens = mainBudget.effectiveWindowTokens - maxOutputTokens;
  return {
    effectiveWindowTokens: mainBudget.effectiveWindowTokens,
    outputLimitTokens: maxOutputTokens,
    inputBudgetTokens,
    toolDefinitionTokens: mainBudget.toolDefinitionTokens,
    messageBudgetTokens: inputBudgetTokens - mainBudget.toolDefinitionTokens,
  };
}
