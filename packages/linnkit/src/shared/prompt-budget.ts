export const DEFAULT_PROMPT_CONTEXT_WINDOW_TOKENS = 256_000;
export const DEFAULT_PROMPT_MAX_OUTPUT_TOKENS = 16_384;

export interface ResolveEffectivePromptBudgetInput {
  policyMaxTokens?: number;
  policyReservedForResponse?: number;
  modelContextWindowTokens?: number;
  modelMaxOutputTokens?: number;
  fallbackContextWindowTokens?: number;
  fallbackMaxOutputTokens?: number;
  toolDefinitionTokens: number;
}

export interface EffectivePromptBudget {
  effectiveWindowTokens: number;
  outputLimitTokens: number;
  inputBudgetTokens: number;
  toolDefinitionTokens: number;
  messageBudgetTokens: number;
}

/**
 * 统一解析一次 LLM 调用的有效 Prompt 预算。
 *
 * 模型 route 是容量基线，Agent policy 只有显式声明时才进一步收窄；
 * 没有模型 route 的独立 host 使用 framework fallback；prepared tools 必须先于 messages 占用输入预算。
 * 该纯函数位于 framework shared 层，让 Context Manager 与 Graph inference 使用同一个数学 owner。
 */
export function resolveEffectivePromptBudget(
  input: ResolveEffectivePromptBudgetInput,
): EffectivePromptBudget {
  assertOptionalPositiveSafeInteger(input.policyMaxTokens, 'policyMaxTokens');
  assertOptionalPositiveSafeInteger(
    input.policyReservedForResponse,
    'policyReservedForResponse',
  );
  assertOptionalPositiveSafeInteger(
    input.modelContextWindowTokens,
    'modelContextWindowTokens',
  );
  assertOptionalPositiveSafeInteger(input.modelMaxOutputTokens, 'modelMaxOutputTokens');
  assertOptionalPositiveSafeInteger(
    input.fallbackContextWindowTokens,
    'fallbackContextWindowTokens',
  );
  assertOptionalPositiveSafeInteger(
    input.fallbackMaxOutputTokens,
    'fallbackMaxOutputTokens',
  );
  assertNonNegativeSafeInteger(input.toolDefinitionTokens, 'toolDefinitionTokens');

  const modelContextWindowTokens = input.modelContextWindowTokens
    ?? input.fallbackContextWindowTokens
    ?? DEFAULT_PROMPT_CONTEXT_WINDOW_TOKENS;
  const modelMaxOutputTokens = input.modelMaxOutputTokens
    ?? input.fallbackMaxOutputTokens
    ?? DEFAULT_PROMPT_MAX_OUTPUT_TOKENS;
  const effectiveWindowTokens = input.policyMaxTokens === undefined
    ? modelContextWindowTokens
    : Math.min(input.policyMaxTokens, modelContextWindowTokens);
  const outputLimitTokens = input.policyReservedForResponse === undefined
    ? modelMaxOutputTokens
    : Math.min(input.policyReservedForResponse, modelMaxOutputTokens);
  const inputBudgetTokens = effectiveWindowTokens - outputLimitTokens;
  if (inputBudgetTokens < 1) {
    throw new Error(
      '有效模型窗口必须大于输出预留，才能形成正数 Prompt 输入预算。',
    );
  }

  const messageBudgetTokens = inputBudgetTokens - input.toolDefinitionTokens;
  if (messageBudgetTokens < 1) {
    throw new Error(
      'Tool definitions 已占满 Prompt 输入预算，无法为 messages 保留 token。',
    );
  }

  return {
    effectiveWindowTokens,
    outputLimitTokens,
    inputBudgetTokens,
    toolDefinitionTokens: input.toolDefinitionTokens,
    messageBudgetTokens,
  };
}

function assertOptionalPositiveSafeInteger(
  value: number | undefined,
  field: string,
): void {
  if (value !== undefined) {
    assertPositiveSafeInteger(value, field);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} 必须是正安全整数。`);
  }
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} 必须是非负安全整数。`);
  }
}
