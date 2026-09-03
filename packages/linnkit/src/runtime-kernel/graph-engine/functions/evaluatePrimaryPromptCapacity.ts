import type { ContextUsageSnapshot } from '../../../contracts';

export type PrimaryPromptCapacityAdmission =
  | { admitted: true }
  | {
      admitted: false;
      usedTokens: number;
      inputBudgetTokens: number;
      exceededByTokens: number;
    };

/** Provider 前的主模型 Prompt 容量判定；等于预算仍可提交，只有严格超出才拒绝。 */
export function evaluatePrimaryPromptCapacity(
  snapshot: ContextUsageSnapshot,
): PrimaryPromptCapacityAdmission {
  if (snapshot.used_tokens <= snapshot.input_budget_tokens) {
    return { admitted: true };
  }

  return {
    admitted: false,
    usedTokens: snapshot.used_tokens,
    inputBudgetTokens: snapshot.input_budget_tokens,
    exceededByTokens: snapshot.used_tokens - snapshot.input_budget_tokens,
  };
}
