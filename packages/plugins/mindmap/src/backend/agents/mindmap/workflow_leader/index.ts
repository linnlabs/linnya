/**
 * @file MindMap Workflow Leader Agent 定义
 *
 * 中文说明：
 * - 父编排 Agent：强制拆解→提假设→验假设的工作流
 * - 只允许“读结构 + 启动子 agent runner 工具”，禁止父 agent 直接写图
 */

import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { MINDMAP_WORKFLOW_LEADER_PROMPT } from './prompt.js';
import { mindmapToolManifest } from '../../../tools/mindmap';

function buildSystemPrompt(): string {
  return buildPrompt(MINDMAP_WORKFLOW_LEADER_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。',
  });
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: MindmapPromptKeys.MINDMAP_WORKFLOW_LEADER,
  promptKey: MindmapPromptKeys.MINDMAP_WORKFLOW_LEADER,
  defaultMode: 'agent',
  description: 'MindMap 工作流父编排 Agent（拆解→假设→验证；子 agent 闭环写图）',

  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 2 } },
    enableTools: true,
    availableTools: mindmapToolManifest.agentTools.workflowLeader,
    knowledgeBaseId: 'default',
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
    stepPolicy: {
      // 父编排最终产物是总结文本，不依赖工具落盘
      kind: 'final_answer',
      lastStepsHintThreshold: 3,
    },
  },

  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default AGENT_DEFINITION;
