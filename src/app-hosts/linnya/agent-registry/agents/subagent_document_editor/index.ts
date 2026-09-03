/**
 * @file src/app-hosts/linnya/agent-registry/agents/subagent_document_editor/index.ts
 * @description 文档编辑专用子 Agent 定义
 *
 * 设计目标：
 * - 专注 Markdown 文档的阅读与编辑，统一通过文件路径工具读写
 * - 可访问知识库做参考，但不能做 web 搜索
 * - 与通用子 agent 共享"隔离执行 + 结果回传"的模式
 */

import type { AgentDefinition } from '../../types';
import { PromptKeys } from '../../prompt.types';
import { buildPrompt } from '../../prompt.builder';
import { SUBAGENT_DOCUMENT_EDITOR_PROMPT } from './prompt';

/**
 * 文档编辑子 Agent 工具白名单
 *
 * 核心能力：Workspace locator 文件读写 + 知识库检索
 * 不包含：web_search / web_read（编辑任务不需要网络搜索）、task（禁止递归）
 */
const SUBAGENT_DOCUMENT_EDITOR_TOOLS = [
  'list_files',
  'read_file',
  'grep',
  'edit_file',
  'write_file',
  // 知识库检索（编辑时可能需要参考资料）
  'search_in_knowledgebase',
  'knowledge_read',
  // Skill（渐进式能力披露：按需加载领域知识与工作流指导）
  'skill',
] as const;

function buildSystemPrompt(): string {
  return buildPrompt(SUBAGENT_DOCUMENT_EDITOR_PROMPT, {
  });
}

export const SUBAGENT_DOCUMENT_EDITOR_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.SUBAGENT_DOCUMENT_EDITOR,
  promptKey: PromptKeys.SUBAGENT_DOCUMENT_EDITOR,
  defaultMode: 'agent',
  description: '文档编辑专用子 Agent（subagent 工具内部使用）',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', keepLatestRuns: 1 },
      systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
    },
    enableTools: true,
    availableTools: SUBAGENT_DOCUMENT_EDITOR_TOOLS,
    skill: {
      enabled: true,
    },
    knowledgeBaseId: 'default',
    // 步数预算属于 Agent 产品策略；通用 subagent 工具不得用私有常量覆盖。
    maxSteps: 60,
    preferredModelCapability: 'tool_calling',
    /**
     * ✅ MaxSteps 收尾提示策略（编辑型子 Agent）
     *
     * 中文备注：
     * - 文档编辑任务的关键是“及时停止额外检索/分析，回到编辑结果确认与总结”；
     * - 但它并没有一个像 deep_research 那样必须在尾段调用的单一固定工具：
     *   可能是 `edit_file`，也可能是 `write_file`，也可能早已完成编辑；
     * - 因此采用 final_answer：只做最后几步提醒，不在预算边界强制某个工具。
     */
    stepPolicy: {
      kind: 'final_answer',
      lastStepsHintThreshold: 12,
    },
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default SUBAGENT_DOCUMENT_EDITOR_AGENT_DEFINITION;
