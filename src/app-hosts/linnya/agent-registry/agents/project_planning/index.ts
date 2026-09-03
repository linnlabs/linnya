/**
 * @file src/app-hosts/linnya/agent-registry/agents/project_planning/index.ts
 * @description Project Planning Agent 定义
 */

import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import { buildPrompt } from '../../prompt.builder';
import { PROJECT_PLANNING_PROMPT } from './prompt';

/**
 * 项目初始化 Agent 工具白名单（内聚定义）
 * 仅保留与工作区文档创建相关能力
 */
const PROJECT_PLANNING_AGENT_TOOLS = [
  'list_files',
  'write_file',
  'search_in_knowledgebase',
  'list_knowledge_base',
  'knowledge_read',
] as const;

function buildSystemPrompt(): string {
  return buildPrompt(PROJECT_PLANNING_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。'
  });
}

function processResponse(rawResponse: string): string {
  // 与现有 ProjectPlanningAgentTask 行为对齐：过滤 <think> 段
  return rawResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function processStreamChunk(chunk: string): string {
  if (chunk.includes('<think>') || chunk.includes('</think>')) {
    return '';
  }
  return chunk;
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.PROJECT_PLANNING,
  promptKey: PromptKeys.PROJECT_PLANNING,
  defaultMode: 'agent',
  description: '项目初始化 / 项目规划 Agent',
  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: PROJECT_PLANNING_AGENT_TOOLS,
    knowledgeBaseId: 'default',
    // ✅ ProjectPlanning(Agent)：使用“用户选择的主模型”
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
    responseProcessor: processResponse,
    streamChunkProcessor: processStreamChunk,
  }
};

export default AGENT_DEFINITION;
