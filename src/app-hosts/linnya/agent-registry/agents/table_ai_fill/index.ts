/**
 * @file src/app-hosts/linnya/agent-registry/agents/table_ai_fill/index.ts
 * @description Table AI Fill Agent 定义
 */

import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import { buildPrompt } from '../../prompt.builder';
import { TABLE_AI_FILL_PROMPT } from './prompt';

/**
 * 表格 AI 填充（按行）Agent 工具白名单（内聚定义）
 */
const TABLE_AI_FILL_AGENT_TOOLS = [
  'knowledge_search',
  'list_knowledge_base',
  'knowledge_read',
  'write_to_table',
] as const;

function buildSystemPrompt(): string {
  return buildPrompt(TABLE_AI_FILL_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。'
  });
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.TABLE_AI_FILL,
  promptKey: PromptKeys.TABLE_AI_FILL,
  defaultMode: 'agent',
  description: '表格 AI 填充（按行）',
  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: TABLE_AI_FILL_AGENT_TOOLS,
    knowledgeBaseId: 'default',
    // ✅ TableAiFill(Agent)：使用“用户选择的主模型”
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
  }
};

export default AGENT_DEFINITION;
