import type {
  ContextUsageSnapshot,
  TokenCountConfidence,
  TokenCountSource,
} from '../../../contracts';

export const PRIMARY_PROMPT_CAPACITY_ERROR_CODE =
  'llm.prompt.input_budget_exceeded' as const;

export interface PrimaryPromptCapacityErrorMetadata {
  readonly modelId: string;
  readonly budgetModelId?: string;
  readonly usedTokens: number;
  readonly inputBudgetTokens: number;
  readonly exceededByTokens: number;
  readonly source: TokenCountSource;
  readonly confidence: TokenCountConfidence;
}

/** 主模型 Prompt 在 Provider admission 前已确认超出输入预算。 */
export class PrimaryPromptCapacityError extends Error {
  readonly errorCode = PRIMARY_PROMPT_CAPACITY_ERROR_CODE;
  readonly recoverable = false;
  readonly metadata: PrimaryPromptCapacityErrorMetadata;

  constructor(snapshot: ContextUsageSnapshot) {
    const exceededByTokens = snapshot.used_tokens - snapshot.input_budget_tokens;
    const activeModelId = snapshot.served_model_id ?? snapshot.budget_model_id;
    super(
      `模型 ${activeModelId} 的 Prompt 超出输入预算 ${exceededByTokens} tokens。`,
    );
    this.name = 'PrimaryPromptCapacityError';
    this.metadata = {
      modelId: activeModelId,
      ...(snapshot.served_model_id
        ? { budgetModelId: snapshot.budget_model_id }
        : {}),
      usedTokens: snapshot.used_tokens,
      inputBudgetTokens: snapshot.input_budget_tokens,
      exceededByTokens,
      source: snapshot.source,
      confidence: snapshot.confidence,
    };
  }
}
