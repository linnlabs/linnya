/**
 * @file src/app-hosts/linnya/agent-registry/agents/default/index.ts
 * @description Default Agent 定义
 *
 * 说明：
 * - prompt 独立在 `prompt.ts`，本文件只做“引用 + 变量注入 + 任务处理逻辑 + 工具配置”
 * - 该 Agent 对应 request.promptKey === 'default'（历史原因：与 Chat 的 default promptKey 同名）
 */

import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import { buildPrompt } from '../../prompt.builder';
import { DEFAULT_AGENT_PROMPT } from './prompt';
import { LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY } from '../systemReminder';

/**
 * 默认 Agent 工具白名单（内聚定义）
 * 说明：项目文件的发现、引用读取与编辑统一走 Workspace locator 文件工具；
 * Knowledge 与 Web 分别使用各自领域的 search/read 工具。
 */
const DEFAULT_AGENT_TOOLS = [
  'list_files',
  'read_file',
  'grep',
  'edit_file',
  'write_file',
  'tool_output_read',

  'knowledge_search',
  'knowledge_read',
  'web_search',
  'web_read',

  'subagent',
  'task_write',
  'task_read',
  'skill',

  'ask',
  'generate_image',

  'shell',
  'process',
] as const;

export function buildDefaultAgentSystemPrompt(): string {
  return buildPrompt(DEFAULT_AGENT_PROMPT);
}

function buildSystemPrompt(): string {
  return buildDefaultAgentSystemPrompt();
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.DEFAULT,
  promptKey: PromptKeys.DEFAULT,
  defaultMode: 'agent',
  description: '默认 Agent（通用执行 Agent）',
  config: {
    // 中文备注：上下文策略在 Agent definition 内聚声明；长任务步数预算同样属于
    // 当前 Agent 的产品配置，不能由共享 GraphExecutor 的框架默认值覆盖。
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', retentionMode: 'drop', keepLatestRuns: 2 },
      systemReminder: LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY,
    },
    enableTools: true,
    availableTools: DEFAULT_AGENT_TOOLS,
    skill: {
      enabled: true,
    },
    knowledgeBaseId: 'default',
    maxSteps: 800,
    // ✅ Default(Agent)：使用“用户选择的主模型”（由前端 determineModelId 注入 options.model_id）
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling'
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default AGENT_DEFINITION;
