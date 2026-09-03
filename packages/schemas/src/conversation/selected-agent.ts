import { z } from 'zod';

/**
 * 会话级选中 Agent 的产品身份。
 *
 * 该值对应 AgentDefinition.id，不是 promptKey，也不是 Renderer 菜单项 id。
 * HTTP 与 SQLite 边界必须 parse；Renderer read model 内保持该名义类型。
 */
export const ConversationSelectedAgentIdSchema = z
  .string()
  .trim()
  .min(1)
  .brand<'ConversationSelectedAgentId'>();

export type ConversationSelectedAgentId = z.infer<typeof ConversationSelectedAgentIdSchema>;

/**
 * 可由 Conversation 产品入口选择的稳定 Agent 身份。
 *
 * 这里保存 AgentDefinition.id；即使当前值恰好与 promptKey 相同，两者也不是同一合同。
 */
export const ConversationAgentIds = {
  DEEP_RESEARCH: ConversationSelectedAgentIdSchema.parse('deep_research_leader'),
} as const;

export const UpdateConversationSelectedAgentRequestSchema = z
  .object({
    selected_agent_id: ConversationSelectedAgentIdSchema.nullable(),
    /** 新草稿在选择 Agent 时正式化；null 表示 Linnya 助手作用域。 */
    project_id: z.string().trim().min(1).nullable(),
  })
  .strict();

export type UpdateConversationSelectedAgentRequest = z.infer<
  typeof UpdateConversationSelectedAgentRequestSchema
>;
