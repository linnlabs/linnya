export const DEFAULT_LLM_MAX_TOTAL_ATTEMPTS = 8;

export interface LlmAttemptBudgetConfig {
  maxRetries: number;
  maxTotalAttempts?: number;
}

export function resolveLlmMaxTotalAttempts(config: LlmAttemptBudgetConfig): number {
  if (config.maxTotalAttempts === undefined) {
    return Math.max(DEFAULT_LLM_MAX_TOTAL_ATTEMPTS, config.maxRetries + 1);
  }

  if (!Number.isInteger(config.maxTotalAttempts) || config.maxTotalAttempts <= 0) {
    throw new Error('[LlmCaller] maxTotalAttempts must be a positive integer.');
  }

  return config.maxTotalAttempts;
}

export function hasLlmAttemptBudgetRemaining(params: {
  actualAttempts: number;
  maxTotalAttempts: number;
}): boolean {
  return params.actualAttempts < params.maxTotalAttempts;
}
