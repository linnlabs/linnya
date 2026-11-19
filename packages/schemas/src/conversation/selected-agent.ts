import * as z from 'zod';
import { PromptKeys } from '../agent-config/index';
import { RESEARCH_AGENT_ID } from '../tools/research-run';

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
  RESEARCH: ConversationSelectedAgentIdSchema.parse(RESEARCH_AGENT_ID),
  PROJECT_PLANNING: ConversationSelectedAgentIdSchema.parse('project_planning'),
  /** 仅保留旧会话与暂停运行的身份，不能映射到新版执行。 */
  DEEP_RESEARCH: ConversationSelectedAgentIdSchema.parse('deep_research_leader'),
} as const;

/**
 * 读取合同里“哪个 Agent”的统一写法：默认 Agent 为 null，其余为 AgentDefinition.id。
 *
 * 对话列表、项目概览和语义层改动记录共用这条约定。显示名由 Renderer 决定：
 * null 显示为 Linnya Agent，其他 ID 从 Agent 注册表取名。
 */
export function toReadModelAgentId(agentId: string | null): string | null {
  return agentId === PromptKeys.DEFAULT ? null : agentId;
}

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
