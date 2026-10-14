import { z } from 'zod';

/** 可回放的运行通知只保存安全诊断身份；供应商 body、stack 和凭据不进入 UI read model。 */
export const ConversationExecutionNoticePayloadSchema = z.object({
  error_code: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  compatible_model_ids: z.array(z.string().min(1)).optional(),
  required_placements: z.array(z.enum(['user_image', 'tool_result_image'])).optional(),
  retry: z.object({
    retry_id: z.string().min(1),
    status: z.enum(['waiting', 'retrying', 'succeeded', 'exhausted', 'failed', 'cancelled']),
    category: z.enum(['transport', 'output', 'rate_limit', 'other']),
    attempt: z.number().int().nonnegative(),
    max_retries: z.number().int().nonnegative(),
    total_attempts: z.number().int().positive(),
    started_at: z.number().finite(),
    updated_at: z.number().finite(),
    next_retry_at: z.number().finite().optional(),
  }).strict().optional(),
}).strict();
export type ConversationExecutionNoticePayload = z.infer<typeof ConversationExecutionNoticePayloadSchema>;

export const ConversationExecutionNoticeMetadataSchema = ConversationExecutionNoticePayloadSchema.extend({
  turn_id: z.string().min(1),
  run_id: z.string().min(1),
  execution_id: z.string().min(1).optional(),
  merge_key: z.string().min(1).optional(),
}).strict();
export type ConversationExecutionNoticeMetadata = z.infer<typeof ConversationExecutionNoticeMetadataSchema>;

/** 仅挑选本产品认可的错误细节，不把未知 details spread 到历史消息。 */
export function projectConversationErrorNotice(input: {
  readonly error_code?: string;
  readonly retryable?: boolean;
  readonly details?: unknown;
}): ConversationExecutionNoticePayload {
  const details = input.details;
  let metadata: Record<string, unknown> | undefined;
  if (typeof details === 'object' && details !== null && !Array.isArray(details)) {
    const direct = 'metadata' in details ? details.metadata : undefined;
    const classification = 'classification' in details ? details.classification : undefined;
    const nested = typeof classification === 'object' && classification !== null && 'metadata' in classification
      ? classification.metadata : undefined;
    const candidate = direct ?? nested;
    if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
      metadata = Object.fromEntries(Object.entries(candidate));
    }
  }
  const ids = metadata?.compatible_model_ids;
  const placements = metadata?.required_placements;
  return ConversationExecutionNoticePayloadSchema.parse({
    ...(input.error_code ? { error_code: input.error_code } : {}),
    ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
    ...(Array.isArray(ids) ? { compatible_model_ids: ids.filter((id): id is string => typeof id === 'string' && id.length > 0) } : {}),
    ...(Array.isArray(placements) ? { required_placements: placements.filter(value => value === 'user_image' || value === 'tool_result_image') } : {}),
  });
}
