import { z } from 'zod';
import { ConversationSelectedAgentIdSchema } from './selected-agent';

/**
 * History API 对外暴露的会话列表项。
 *
 * selected_agent_id 是正式控制面；metadata 不得承载 Agent 选择。
 */
export const ConversationHistoryListItemSchema = z
  .object({
    conversation_id: z.string().trim().min(1),
    title: z.string(),
    created_at: z.number().finite(),
    last_event_at: z.number().finite(),
    event_count: z.number().int().nonnegative(),
    preview_text: z.string().optional(),
    user_message_count: z.number().int().nonnegative(),
    project_id: z.string().nullable().optional(),
    is_pinned: z.boolean(),
    pinned_at: z.number().finite().optional(),
    selected_agent_id: ConversationSelectedAgentIdSchema.nullable(),
    /** cleanup job 仍存在时禁止重新进入，并由用户显式重试原操作。 */
    cleanup_pending: z.boolean().optional(),
  })
  .strict();

export type ConversationHistoryListItem = z.infer<typeof ConversationHistoryListItemSchema>;

export const ConversationHistoryListResponseSchema = z
  .object({
    success: z.literal(true),
    conversations: z.array(ConversationHistoryListItemSchema),
    next_cursor: z.string().optional(),
    has_more: z.boolean(),
  })
  .strict();

export type ConversationHistoryListResponse = z.infer<
  typeof ConversationHistoryListResponseSchema
>;

export const ConversationCleanupRetryOutcomeSchema = z.enum([
  'conversation_deleted',
  'work_directory_cleared',
  'not_found',
  'still_pending',
]);
export type ConversationCleanupRetryOutcome = z.infer<
  typeof ConversationCleanupRetryOutcomeSchema
>;

export const ConversationCleanupRetryResponseSchema = z.object({
  success: z.literal(true),
  outcome: ConversationCleanupRetryOutcomeSchema,
}).strict();

export const ConversationHistoryMetadataSchema = ConversationHistoryListItemSchema
  .extend({
    current_revision: z.number().int().nonnegative(),
    mode: z.string().optional(),
  })
  .strict();

export type ConversationHistoryMetadata = z.infer<typeof ConversationHistoryMetadataSchema>;

export const ConversationHistoryMetadataResponseSchema = ConversationHistoryMetadataSchema
  .extend({ success: z.literal(true) })
  .strict();

export const UpdateConversationSelectedAgentResponseSchema = z
  .object({
    success: z.literal(true),
    selected_agent_id: ConversationSelectedAgentIdSchema.nullable(),
  })
  .strict();
