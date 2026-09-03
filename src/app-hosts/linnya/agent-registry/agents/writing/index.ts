/**
 * @file src/app-hosts/linnya/agent-registry/agents/writing/index.ts
 * @description Writing Agent 定义
 *
 * 约定：
 * - prompt 单独放在 `prompt.ts`，便于直接复制/对比，降低“提示词变形”的风险
 * - 本文件只负责“引用 prompt + 声明配置 + 声明任务处理逻辑”
 */

import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import { buildPrompt } from '../../prompt.builder';
import { WRITING_AGENT_PROMPT } from './prompt';

/**
 * 写作 Agent 工具白名单（内聚定义）
 */
const WRITING_AGENT_TOOLS = [
  'knowledge_search',
  'list_knowledge_base',
  'knowledge_read',
  'ask',
] as const;

// === 2. 逻辑函数 (原 src/agent/tasks/writing.ts) ===

function buildSystemPrompt(): string {
  // 一个任务一个完整 prompt：writing 任务直接使用 writing 模板构建
  return buildPrompt(WRITING_AGENT_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。'
  });
}

function processResponse(rawResponse: string): string {
  // 移除 <think> 标签及其内容，保持输出的干净性
  return rawResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function processStreamChunk(chunk: string): string {
  // 简单过滤，在流式输出中也移除思考标签
  if (chunk.includes('<think>') || chunk.includes('</think>')) {
    return '';
  }
  return chunk;
}

// === 3. Agent Definition ===

export const WRITING_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.WRITING,
  promptKey: PromptKeys.WRITING,
  defaultMode: 'agent',
  description: '写作助手（Writing）- 专用于编辑器内容生成',
  
  // 配置收编
  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: WRITING_AGENT_TOOLS,
    knowledgeBaseId: 'default',
    // ✅ Writing(Agent)：使用“用户选择的主模型”
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'chat'
  },

  // 任务逻辑收编
  task: {
    systemPromptBuilder: buildSystemPrompt,
    responseProcessor: processResponse,
    streamChunkProcessor: processStreamChunk
  }
};

/**
 * 默认导出：便于 `src/app-hosts/linnya/agent-registry/agents/index.ts` 聚合所有 agent 定义（与 tools 模式一致）
 */
export default WRITING_AGENT_DEFINITION;
