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
export const ScheduledAgentIds = {
  default: 'scheduled_default',
  research: 'scheduled_research',
} as const;

export const ConversationAgentIds = {
  RESEARCH: ConversationSelectedAgentIdSchema.parse(RESEARCH_AGENT_ID),
  PROJECT_PLANNING: ConversationSelectedAgentIdSchema.parse('project_planning'),
} as const;

/**
 * 读取合同里“哪个 Agent”的统一写法：默认 Agent 为 null，其余为 AgentDefinition.id。
 *
 * 对话列表、项目概览和语义层改动记录共用这条约定。显示名由 Renderer 决定：
 * null 显示为 Linnya Agent，其他 ID 从 Agent 注册表取名。会话自己持久化的选择
 * （历史列表与元数据）由 `readConversationSelectedAgentId` 在读取边界套用同一约定。
 */
export function toReadModelAgentId(agentId: string | null): string | null {
  if (agentId === PromptKeys.DEFAULT || agentId === ScheduledAgentIds.default) return null;
  return agentId === ScheduledAgentIds.research ? RESEARCH_AGENT_ID : agentId;
}

/**
 * 持久化的会话 Agent 选择 → 读取合同：默认 Agent 一律是 null，其余为 AgentDefinition.id。
 *
 * 旧数据曾把默认 Agent 的 ID 字面量 `default` 原样写进库（例如 CLI 的 `send --agent default`）。
 * 它与未选择是同一个意思，读取边界在这里归一一次；Renderer 与其他读取方不需要各自识别，
 * 已不可用的注册表 ID 仍原样返回，由展示层按注册表判断。
 */
export function readConversationSelectedAgentId(
  stored: string | null
): ConversationSelectedAgentId | null {
  if (stored === null) return null;
  const agentId = toReadModelAgentId(ConversationSelectedAgentIdSchema.parse(stored));
  return agentId === null ? null : ConversationSelectedAgentIdSchema.parse(agentId);
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
