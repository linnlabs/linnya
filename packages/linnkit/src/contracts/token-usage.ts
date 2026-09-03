import { z } from 'zod';

/**
 * Token 计数来源：每个 token 数字都必须说明从哪里来，避免把估算当成账单事实。
 */
export const TokenCountSource = z.enum([
  'local-estimate',
  'provider-preflight-count',
  'provider-response-usage',
  'host-supplied',
  'test-fixture',
]);
export type TokenCountSource = z.infer<typeof TokenCountSource>;

/**
 * Token 计数可信度：只有 actual 才能进入真实计费与后续校准。
 */
export const TokenCountConfidence = z.enum([
  'estimate',
  'provider-estimate',
  'actual',
]);
export type TokenCountConfidence = z.infer<typeof TokenCountConfidence>;

/**
 * 当前调用 route 的 token 能力声明。
 *
 * 这些能力由 host 的 model catalog 声明；linnkit 不内置 provider 到能力的映射表。
 */
export const TokenRouteCapabilities = z.object({
  supportsRemoteTokenCount: z.boolean().optional(),
  supportsResponseUsage: z.boolean().optional(),
  supportsCachedInputBilling: z.boolean().optional(),
  supportsReasoningTokens: z.boolean().optional(),
});
export type TokenRouteCapabilities = z.infer<typeof TokenRouteCapabilities>;

/**
 * Token 计算路由：同一个模型经不同 gateway 时，计数能力可能完全不同。
 */
export const TokenRoute = z.object({
  capabilityId: z.string().describe('Host 侧不透明 token accounting capability 或 route 标识'),
  baseURL: z.string().optional().describe('中转平台或私有 endpoint；用于区分同名模型的不同 route'),
  modelId: z.string().describe('host 侧模型 id'),
  endpointModelId: z.string().optional().describe('下游 endpoint 实际模型名（与 host modelId 可能不同）'),
  capabilities: TokenRouteCapabilities.optional(),
});
export type TokenRoute = z.infer<typeof TokenRoute>;

const tokenCount = z.number().int().nonnegative();

/**
 * 归一化后的 LLM 用量。
 *
 * 关键约束：
 * - inputTokens 是非缓存普通输入 token，不含 cacheRead/cacheWrite；图片 token 若被 provider
 *   单列，仍已包含在 inputTokens 内，imageInputTokens 只作组成说明，禁止再次相加或计费。
 * - reasoning/cache 字段用 optional 表达“未上报”和“明确为 0”的差异。
 * - totalTokens 可缺失，也不保证等于各分项之和。
 * - rawUsage 仅供审计；业务逻辑应依赖 canonical 字段。
 */
export const CanonicalLlmUsage = z.object({
  inputTokens: tokenCount.describe('非缓存普通输入 token'),
  imageInputTokens: tokenCount.optional().describe('inputTokens 中的图片输入分项；undefined=provider 未单列'),
  outputTokens: tokenCount.describe('输出 token'),
  reasoningTokens: tokenCount.optional().describe('推理 token；undefined=未单列，0=报告为 0'),
  cacheReadTokens: tokenCount.optional().describe('缓存命中读取 token'),
  cacheWriteTokens: tokenCount.optional().describe('缓存写入 token'),
  totalTokens: tokenCount.optional().describe('provider 报告的总量；可缺失，且不保证等于各项之和'),
  source: TokenCountSource,
  confidence: TokenCountConfidence,
  rawUsage: z.unknown().optional().describe('原始 provider usage，仅供审计'),
});
export type CanonicalLlmUsage = z.infer<typeof CanonicalLlmUsage>;

const contextUsageTokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contextUsageSafeInteger = z.number().int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

const contextUsageComponents = z.object({
  system_prompt_tokens: contextUsageTokenCount,
  conversation_tokens: contextUsageTokenCount,
  tool_definition_tokens: contextUsageTokenCount,
}).strict();

/** 最近一次成功提交给模型的 Prompt 上下文占用。 */
export const ContextUsageSnapshot = z.object({
  basis: z.literal('last_completed_llm_prompt'),
  budget_model_id: z.string().min(1),
  served_model_id: z.string().min(1).optional(),
  used_tokens: contextUsageTokenCount,
  components: contextUsageComponents,
  component_attribution: z.literal('normalized_local_estimate'),
  input_budget_tokens: contextUsageTokenCount.positive(),
  remaining_tokens: contextUsageSafeInteger,
  output_limit_tokens: contextUsageTokenCount.positive(),
  source: TokenCountSource,
  confidence: TokenCountConfidence,
  measured_at: z.number().finite().nonnegative(),
}).strict().superRefine((snapshot, context) => {
  const componentTotal = snapshot.components.system_prompt_tokens
    + snapshot.components.conversation_tokens
    + snapshot.components.tool_definition_tokens;
  if (componentTotal !== snapshot.used_tokens) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['components'],
      message: 'Context usage components 之和必须等于 used_tokens。',
    });
  }
  if (snapshot.remaining_tokens !== snapshot.input_budget_tokens - snapshot.used_tokens) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['remaining_tokens'],
      message: 'remaining_tokens 必须等于 input_budget_tokens - used_tokens。',
    });
  }
});
export type ContextUsageSnapshot = z.infer<typeof ContextUsageSnapshot>;

/** Context Manager 交给 Graph 最终 Prompt measurer 的已解析计数策略。 */
export const PromptUsageMeasurementPolicy = z.object({
  token_route: TokenRoute.optional(),
  remote_count_enabled: z.boolean(),
  remote_count_failure_behavior: z.enum(['use-local-estimate', 'fail-fast']),
  calibration_coefficient: z.number().positive().optional(),
}).strict();
export type PromptUsageMeasurementPolicy = z.infer<typeof PromptUsageMeasurementPolicy>;
