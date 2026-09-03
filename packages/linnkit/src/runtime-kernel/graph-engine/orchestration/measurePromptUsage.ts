import {
  ContextUsageSnapshot,
  type PromptUsageMeasurementPolicy,
  type TokenRoute,
} from '../../../contracts';
import type {
  LlmCallOptions,
  LlmRequestMessage,
  TokenCounterPort,
  TokenizerPort,
} from '../../../ports';
import type { EffectivePromptBudget } from '../functions/resolveEffectivePromptBudget';
import {
  estimatePromptUsageComponentWeights,
  normalizePromptUsageComponents,
} from '../functions/promptUsageComponents';

export interface MeasurePromptUsageInput {
  budgetModelId: string;
  servedModelId: string;
  messages: readonly LlmRequestMessage[];
  llmOptions: Readonly<LlmCallOptions>;
  promptBudget: EffectivePromptBudget;
  measurementPolicy: PromptUsageMeasurementPolicy;
  imageInputTokens?: number;
  signal?: AbortSignal;
}

export interface PromptUsageMeasurerDependencies {
  tokenizer: TokenizerPort;
  tokenCounter?: TokenCounterPort;
  resolveTokenRoute?: (modelId: string) => TokenRoute | undefined;
  now?: () => number;
}

export type PromptUsageMeasurer = (
  input: MeasurePromptUsageInput,
) => Promise<ContextUsageSnapshot>;

export function createPromptUsageMeasurer(
  dependencies: PromptUsageMeasurerDependencies,
): PromptUsageMeasurer {
  const now = dependencies.now ?? Date.now;
  return async input => {
    const measurementPolicy = resolveMeasurementPolicy(input, dependencies.resolveTokenRoute);
    const imageInputTokens = input.imageInputTokens ?? 0;
    const weights = estimatePromptUsageComponentWeights({
      messages: input.messages,
      tools: input.llmOptions.tools,
      toolChoice: input.llmOptions.tool_choice,
      tokenizer: dependencies.tokenizer,
      modelId: input.servedModelId,
      imageInputTokens,
    });
    const rawLocalTotal = weights.systemPromptTokens
      + weights.conversationTokens
      + weights.toolDefinitionTokens;
    const calibratedLocalTotal = applyCalibration(
      rawLocalTotal,
      imageInputTokens,
      measurementPolicy.calibration_coefficient,
    );
    const remoteResult = await countRemoteIfEnabled({
      input,
      measurementPolicy,
      tokenCounter: dependencies.tokenCounter,
    });
    const usedTokens = remoteResult?.inputTokens ?? calibratedLocalTotal;
    const components = normalizePromptUsageComponents(usedTokens, weights);

    return ContextUsageSnapshot.parse({
      basis: 'last_completed_llm_prompt',
      budget_model_id: input.budgetModelId,
      ...(input.servedModelId !== input.budgetModelId
        ? { served_model_id: input.servedModelId }
        : {}),
      used_tokens: usedTokens,
      components,
      component_attribution: 'normalized_local_estimate',
      input_budget_tokens: input.promptBudget.inputBudgetTokens,
      remaining_tokens: input.promptBudget.inputBudgetTokens - usedTokens,
      output_limit_tokens: input.promptBudget.outputLimitTokens,
      source: remoteResult?.source ?? 'local-estimate',
      confidence: remoteResult?.confidence ?? 'estimate',
      measured_at: now(),
    });
  };
}

function resolveMeasurementPolicy(
  input: MeasurePromptUsageInput,
  resolveTokenRoute: PromptUsageMeasurerDependencies['resolveTokenRoute'],
): PromptUsageMeasurementPolicy {
  if (input.servedModelId === input.budgetModelId) return input.measurementPolicy;
  const tokenRoute = resolveTokenRoute?.(input.servedModelId);
  return {
    ...(tokenRoute ? { token_route: tokenRoute } : {}),
    remote_count_enabled: input.measurementPolicy.remote_count_enabled,
    remote_count_failure_behavior: input.measurementPolicy.remote_count_failure_behavior,
    // 校准样本严格按 route 隔离；fallback 不能复用 primary route 的系数。
  };
}

async function countRemoteIfEnabled(input: {
  input: MeasurePromptUsageInput;
  measurementPolicy: PromptUsageMeasurementPolicy;
  tokenCounter?: TokenCounterPort;
}) {
  const { measurementPolicy, tokenCounter } = input;
  const route = measurementPolicy.token_route;
  if (
    !measurementPolicy.remote_count_enabled
    || !tokenCounter
    || !route
    || route.capabilities?.supportsRemoteTokenCount !== true
    || (input.input.imageInputTokens ?? 0) > 0
  ) {
    return undefined;
  }

  try {
    return await tokenCounter.countMessages({
      route,
      messages: [...input.input.messages],
      ...(input.input.llmOptions.tools
        ? { tools: input.input.llmOptions.tools }
        : {}),
      ...(input.input.signal ? { signal: input.input.signal } : {}),
    });
  } catch (error) {
    if (measurementPolicy.remote_count_failure_behavior === 'fail-fast') throw error;
    return undefined;
  }
}

function applyCalibration(
  rawLocalTotal: number,
  imageInputTokens: number,
  coefficient: number | undefined,
): number {
  if (coefficient === undefined) return rawLocalTotal;
  const textAndToolTokens = rawLocalTotal - imageInputTokens;
  return Math.ceil(textAndToolTokens * coefficient) + imageInputTokens;
}
