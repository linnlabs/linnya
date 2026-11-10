import { ConversationContextUsageSchema } from '@app/schemas';
import type { graph } from '@linnlabs/linnkit/runtime-kernel';

export function projectContextEstimate(
  modelId: string,
  context: graph.GraphExecutorContextBuildOutput,
) {
  const { promptBudget, tokenComponents } = context;
  if (!promptBudget || !tokenComponents) return null;

  let systemTokens = 0;
  let conversationTokens = 0;
  for (const component of tokenComponents) {
    if (!component.kept) continue;
    if (component.role === 'system') systemTokens += component.tokens;
    else conversationTokens += component.tokens;
  }
  const toolTokens = promptBudget.toolDefinitionTokens;
  const usedTokens = systemTokens + conversationTokens + toolTokens;
  const outputLimit = Math.max(1, Math.min(
    promptBudget.outputLimitTokens, promptBudget.effectiveWindowTokens - usedTokens,
  ));
  const inputBudget = promptBudget.effectiveWindowTokens - outputLimit;
  return ConversationContextUsageSchema.parse({
    budget_model_id: modelId,
    used_tokens: usedTokens,
    components: {
      system_prompt_tokens: systemTokens,
      conversation_tokens: conversationTokens,
      tool_definition_tokens: toolTokens,
    },
    input_budget_tokens: inputBudget,
    remaining_tokens: inputBudget - usedTokens,
    output_limit_tokens: outputLimit,
    source: 'local-estimate',
    confidence: 'estimate',
  });
}
