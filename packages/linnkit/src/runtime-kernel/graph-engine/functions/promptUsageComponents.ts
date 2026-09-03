import type { ContextUsageSnapshot } from '../../../contracts';
import type {
  CanonicalInferenceTool,
  CanonicalToolChoice,
  LlmRequestMessage,
  TokenizerPort,
} from '../../../ports';

export interface PromptUsageComponentWeights {
  systemPromptTokens: number;
  conversationTokens: number;
  toolDefinitionTokens: number;
}

export function estimateToolDefinitionTokens(input: {
  tools?: readonly CanonicalInferenceTool[];
  toolChoice?: CanonicalToolChoice;
  tokenizer: TokenizerPort;
  modelId: string;
}): number {
  if (!input.tools || input.tools.length === 0) return 0;
  return readTokenEstimate(
    input.tokenizer.estimateText(JSON.stringify({
      tools: input.tools,
      tool_choice: input.toolChoice,
    }), input.modelId),
    'Tool definitions',
  );
}

export function estimatePromptUsageComponentWeights(input: {
  messages: readonly LlmRequestMessage[];
  tools?: readonly CanonicalInferenceTool[];
  toolChoice?: CanonicalToolChoice;
  tokenizer: TokenizerPort;
  modelId: string;
  imageInputTokens?: number;
}): PromptUsageComponentWeights {
  let systemPromptTokens = 0;
  let conversationTokens = 0;
  for (const message of input.messages) {
    const tokens = readTokenEstimate(
      input.tokenizer.estimateMessage(message, input.modelId),
      `${message.role} message`,
    );
    if (message.role === 'system') systemPromptTokens += tokens;
    else conversationTokens += tokens;
  }

  const imageInputTokens = input.imageInputTokens ?? 0;
  readTokenEstimate(imageInputTokens, 'Image input');
  conversationTokens += imageInputTokens;

  return {
    systemPromptTokens,
    conversationTokens,
    toolDefinitionTokens: estimateToolDefinitionTokens({
      tools: input.tools,
      toolChoice: input.toolChoice,
      tokenizer: input.tokenizer,
      modelId: input.modelId,
    }),
  };
}

/** 用最大余数法把 provider 总数稳定归因到三个本地估算权重。 */
export function normalizePromptUsageComponents(
  usedTokens: number,
  weights: PromptUsageComponentWeights,
): ContextUsageSnapshot['components'] {
  readTokenEstimate(usedTokens, 'Prompt used tokens');
  const orderedWeights = [
    weights.systemPromptTokens,
    weights.conversationTokens,
    weights.toolDefinitionTokens,
  ].map((value, index) => readTokenEstimate(value, `Prompt component ${index}`));
  if (usedTokens === 0) {
    return {
      system_prompt_tokens: 0,
      conversation_tokens: 0,
      tool_definition_tokens: 0,
    };
  }

  const weightTotal = orderedWeights.reduce((sum, value) => sum + value, 0);
  if (weightTotal === 0) {
    throw new Error('Prompt used tokens 大于 0 时，三项本地归因权重不能全为 0。');
  }

  const exact = orderedWeights.map(weight => usedTokens * weight / weightTotal);
  const allocated = exact.map(value => Math.floor(value));
  let remaining = usedTokens - allocated.reduce((sum, value) => sum + value, 0);
  const allocationOrder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const item of allocationOrder) {
    if (remaining === 0) break;
    allocated[item.index] = (allocated[item.index] ?? 0) + 1;
    remaining -= 1;
  }

  return {
    system_prompt_tokens: allocated[0] ?? 0,
    conversation_tokens: allocated[1] ?? 0,
    tool_definition_tokens: allocated[2] ?? 0,
  };
}

function readTokenEstimate(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} token 估算必须是非负安全整数。`);
  }
  return value;
}
