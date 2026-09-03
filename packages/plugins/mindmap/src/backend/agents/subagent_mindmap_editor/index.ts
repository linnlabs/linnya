/**
 * @file packages/plugins/mindmap/src/backend/agents/subagent_mindmap_editor/index.ts
 * @description 思维导图编辑专用子 Agent 定义
 *
 * 设计目标：
 * - 专注纯 MindMap 文档的创建与 outline 编辑
 * - 使用统一文件工具读写 .mindmap
 * - 与 mindmap/* 系列 agent 的区别：本 agent 是通用 MindMap 编辑，
 *   mindmap/* 系列是结构化工作流（拆解/假设/验证）的专用 agent
 */

import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { SUBAGENT_MINDMAP_EDITOR_PROMPT } from './prompt';

/**
 * 思维导图编辑子 Agent 工具白名单
 *
 * 核心能力：list_files/read_file/grep/edit_file/write_file + 知识库检索
 */
const SUBAGENT_MINDMAP_EDITOR_TOOLS = [
  // Workspace 文件工具
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
  return buildPrompt(SUBAGENT_MINDMAP_EDITOR_PROMPT, {
  });
}

export const SUBAGENT_MINDMAP_EDITOR_AGENT_DEFINITION: AgentDefinition = {
  id: MindmapPromptKeys.SUBAGENT_MINDMAP_EDITOR,
  promptKey: MindmapPromptKeys.SUBAGENT_MINDMAP_EDITOR,
  defaultMode: 'agent',
  description: '思维导图编辑专用子 Agent（subagent 工具内部使用）',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', keepLatestRuns: 1 },
      systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
    },
    enableTools: true,
    availableTools: SUBAGENT_MINDMAP_EDITOR_TOOLS,
    skill: {
      enabled: true,
    },
    knowledgeBaseId: 'default',
    maxSteps: 60,
    preferredModelCapability: 'tool_calling',
    /**
     * ✅ MaxSteps 收尾提示策略（MindMap 编辑型子 Agent）
     *
     * 中文备注：
     * - MindMap 任务的尾段重点是“停止继续发散，检查结构完整性并收尾说明”；
     * - 最终修改可能是创建节点、打标签、挂证据，也可能在阈值前已完成；
     * - 因此不强制某个固定工具，只在最后几步提醒模型收敛。
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

export default SUBAGENT_MINDMAP_EDITOR_AGENT_DEFINITION;
