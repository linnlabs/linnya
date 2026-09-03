import { z } from 'zod';
import { TokenRoute } from './token-usage';

const tokenCount = z.number().int().nonnegative();
const actualCalibrationSource = z.enum([
  'provider-response-usage',
  'host-supplied',
  'test-fixture',
]);

/**
 * 上下文预算校准样本。
 *
 * 中文备注：sample 只描述“一次实际发送前的本地估算”和“响应后的真实输入占用”。
 * 是否采纳 actual、是否匹配 route 由 context-manager 的纯函数判断，避免 host 注入时夹带策略。
 */
export const TokenUsageCalibrationSample = z.object({
  route: TokenRoute,
  localEstimateTokens: tokenCount,
  actualInputTokens: tokenCount,
  source: actualCalibrationSource,
  confidence: z.literal('actual'),
  observedAt: z.number().int().nonnegative().optional(),
  runId: z.string().optional(),
  ledgerEntryId: z.string().optional(),
});
export type TokenUsageCalibrationSample = z.infer<typeof TokenUsageCalibrationSample>;

export const TokenUsageCalibrationTrace = z.object({
  enabled: z.boolean(),
  applied: z.boolean(),
  route: TokenRoute.optional(),
  sampleCount: z.number().int().nonnegative(),
  coefficient: z.number().positive().optional(),
  minSamples: z.number().int().positive().optional(),
  minCoefficient: z.number().positive().optional(),
  maxCoefficient: z.number().positive().optional(),
  localEstimateTokens: tokenCount.optional(),
  calibratedEstimateTokens: tokenCount.optional(),
  deltaTokens: z.number().int().optional(),
  sampleLedgerEntryIds: z.array(z.string()).optional(),
});
export type TokenUsageCalibrationTrace = z.infer<typeof TokenUsageCalibrationTrace>;

/**
 * 一次 context build 最终发送消息的构建期 token 估算。
 *
 * 中文备注：
 * - localEstimateTokens 是未校准的本地 tokenizer 合计，用于和响应后 actual 输入配对成样本；
 * - calibratedEstimateTokens/finalTokens 是本轮实际参与预算与截断的构建期口径；
 * - 这里不表达 provider preflight count 或响应后 actual usage，避免把不同来源混成一个数字。
 */
export const ContextBuildTokenEstimate = z.object({
  route: TokenRoute.optional(),
  localEstimateTokens: tokenCount,
  calibratedEstimateTokens: tokenCount,
  finalTokens: tokenCount,
  source: z.literal('local-estimate'),
  confidence: z.literal('estimate'),
});
export type ContextBuildTokenEstimate = z.infer<typeof ContextBuildTokenEstimate>;
