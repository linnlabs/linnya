import { z } from 'zod';

/** Conversation 摘要展示需要的统计信息；比例统一使用 0..1。 */
export const ConversationSummaryInfoSchema = z.object({
  originalMessageCount: z.number().int().nonnegative(),
  compressedMessageCount: z.number().int().nonnegative().optional(),
  compressionRatio: z.number().min(0).max(1).optional(),
  timeSaved: z.string().min(1).optional(),
}).strict();
export type ConversationSummaryInfo = z.infer<typeof ConversationSummaryInfoSchema>;

/** Renderer-only 摘要进度身份；由 summarization_start 的 event id 唯一派生。 */
export const ConversationSummarizationPresentationIdSchema = z.string()
  .startsWith('summarization_progress:')
  .brand<'ConversationSummarizationPresentationId'>();
export type ConversationSummarizationPresentationId = z.infer<
  typeof ConversationSummarizationPresentationIdSchema
>;

export function conversationSummarizationPresentationIdFromEventId(
  eventId: string,
): ConversationSummarizationPresentationId {
  return ConversationSummarizationPresentationIdSchema.parse(`summarization_progress:${eventId}`);
}

export const ConversationSummarizationProgressMetadataSchema = z.object({
  summarization_id: z.string().min(1),
  turn_id: z.string().min(1),
  run_id: z.string().min(1),
  execution_id: z.string().min(1),
  summary: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('summarizing'),
      info: ConversationSummaryInfoSchema,
    }).strict(),
    z.object({
      status: z.literal('completed'),
      info: ConversationSummaryInfoSchema,
      /** completed presentation 只能由这一条 durable summary fact 收口。 */
      historySummaryId: z.string().min(1),
    }).strict(),
    z.object({
      status: z.literal('error'),
      info: ConversationSummaryInfoSchema,
    }).strict(),
  ]),
}).strict();
export type ConversationSummarizationProgressMetadata = z.infer<
  typeof ConversationSummarizationProgressMetadataSchema
>;

/**
 * durable history_summary 的唯一 payload 合同。
 *
 * `status` 不在这里重复表达：history_summary 事实一旦存在就必然已经完成；
 * summarization_start/end/error 是实时 presentation，不允许写入 durable row。
 */
export const ConversationHistorySummaryPayloadSchema = z.object({
  summary: z.object({
    info: ConversationSummaryInfoSchema,
    replacedMessageIds: z.array(z.string().min(1)),
    includedOldSummary: z.boolean().optional(),
  }).strict(),
}).strict();
export type ConversationHistorySummaryPayload = z.infer<typeof ConversationHistorySummaryPayloadSchema>;
