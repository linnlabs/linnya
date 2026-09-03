import { z } from 'zod';
import { CanonicalLlmUsage, TokenCountConfidence, TokenCountSource, TokenRoute } from './token-usage';

const tokenCount = z.number().int().nonnegative();
const tokenPrice = z.number().finite().nonnegative();

export const TokenLedgerEntryKind = z.enum([
  'llm-usage',
  'context-component',
]);
export type TokenLedgerEntryKind = z.infer<typeof TokenLedgerEntryKind>;

export const ContextTokenComponentKind = z.enum([
  'system',
  'user',
  'assistant',
  'tool',
  'context-injection',
  'history-summary',
  'working-memory',
  'fence',
  'system-reminder',
  'image-attachment',
  'other',
]);
export type ContextTokenComponentKind = z.infer<typeof ContextTokenComponentKind>;

export const TokenUsageTotals = z.object({
  inputTokens: tokenCount,
  imageInputTokens: tokenCount.optional(),
  outputTokens: tokenCount,
  reasoningTokens: tokenCount.optional(),
  cacheReadTokens: tokenCount.optional(),
  cacheWriteTokens: tokenCount.optional(),
  totalTokens: tokenCount.optional(),
  usageCount: z.number().int().nonnegative(),
});
export type TokenUsageTotals = z.infer<typeof TokenUsageTotals>;

export const ContextTokenComponent = z.object({
  componentId: z.string().min(1),
  kind: ContextTokenComponentKind,
  tokens: tokenCount,
  source: TokenCountSource,
  confidence: TokenCountConfidence,
  label: z.string().optional(),
  messageId: z.string().optional(),
  role: z.string().optional(),
  action: z.string().optional(),
  kept: z.boolean().optional(),
  truncatedAtExecution: z.boolean().optional(),
  originalTokensEstimate: tokenCount.optional(),
  droppedTokensEstimate: tokenCount.optional(),
  attachmentId: z.string().optional(),
  resourceId: z.string().optional(),
  placement: z.enum(['user_image', 'tool_result_image']).optional(),
  attachmentIndex: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  profileId: z.string().optional(),
  estimatorVersion: z.string().optional(),
});
export type ContextTokenComponent = z.infer<typeof ContextTokenComponent>;

const TokenLedgerEntryBase = z.object({
  id: z.string().min(1),
  runId: z.string().optional(),
  parentRunId: z.string().optional(),
  conversationId: z.string().optional(),
  turnId: z.string().optional(),
  stepId: z.string().optional(),
  route: TokenRoute.optional(),
  createdAt: z.number().int().nonnegative().optional(),
});

export const LlmUsageTokenLedgerEntry = TokenLedgerEntryBase.extend({
  kind: z.literal('llm-usage'),
  modelId: z.string().optional(),
  usage: CanonicalLlmUsage,
});
export type LlmUsageTokenLedgerEntry = z.infer<typeof LlmUsageTokenLedgerEntry>;

export const ContextComponentTokenLedgerEntry = TokenLedgerEntryBase.extend({
  kind: z.literal('context-component'),
  components: z.array(ContextTokenComponent),
  totalTokens: tokenCount,
});
export type ContextComponentTokenLedgerEntry = z.infer<typeof ContextComponentTokenLedgerEntry>;

export const TokenLedgerEntry = z.discriminatedUnion('kind', [
  LlmUsageTokenLedgerEntry,
  ContextComponentTokenLedgerEntry,
]);
export type TokenLedgerEntry = z.infer<typeof TokenLedgerEntry>;

export const TokenLedgerAggregate = z.object({
  llmUsage: TokenUsageTotals.optional(),
  contextTokens: tokenCount,
  entryCount: z.number().int().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  contextComponentCount: z.number().int().nonnegative(),
});
export type TokenLedgerAggregate = z.infer<typeof TokenLedgerAggregate>;

export const RunTokenUsageAggregate = z.object({
  /**
   * 父 run 自己产生的 usage；子 run 必须放到 children，避免展示或计费时重复相加。
   */
  own: TokenLedgerAggregate,
  children: TokenLedgerAggregate.optional(),
});
export type RunTokenUsageAggregate = z.infer<typeof RunTokenUsageAggregate>;

export const TokenCostComponent = z.enum([
  'input',
  'output',
  'reasoning',
  'cacheRead',
  'cacheWrite',
]);
export type TokenCostComponent = z.infer<typeof TokenCostComponent>;

/**
 * 已解析的有效单价。阶梯、币种换算、套餐抵扣都应由 host 在传入前处理完。
 */
export const TokenPricing = z.object({
  currency: z.string().min(1),
  unit: z.literal('per_1m_tokens'),
  input: tokenPrice.optional(),
  output: tokenPrice.optional(),
  reasoning: tokenPrice.optional(),
  cacheRead: tokenPrice.optional(),
  cacheWrite: tokenPrice.optional(),
});
export type TokenPricing = z.infer<typeof TokenPricing>;

export const CostBreakdown = z.object({
  status: z.enum(['computed', 'unknown']),
  currency: z.string().optional(),
  inputCost: tokenPrice.optional(),
  outputCost: tokenPrice.optional(),
  reasoningCost: tokenPrice.optional(),
  cacheReadCost: tokenPrice.optional(),
  cacheWriteCost: tokenPrice.optional(),
  totalCost: tokenPrice.optional(),
  missingPriceComponents: z.array(TokenCostComponent).optional(),
});
export type CostBreakdown = z.infer<typeof CostBreakdown>;
