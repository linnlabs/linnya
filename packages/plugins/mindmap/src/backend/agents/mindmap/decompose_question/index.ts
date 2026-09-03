/**
 * @file MindMap Decompose Question Agent 定义
 *
 * 中文说明：
 * - 该 Agent 仅用于“拆解问题”（右键 question 节点）
 * - 工具集严格收缩：读结构 + 创建子问题节点
 * - 禁止打标/挂证据（防止把“拆解”变成“验证闭环”）
 */
import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { MINDMAP_DECOMPOSE_QUESTION_PROMPT } from './prompt.js';
import { mindmapToolManifest } from '../../../tools/mindmap';

function buildSystemPrompt(): string {
  return buildPrompt(MINDMAP_DECOMPOSE_QUESTION_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。',
  });
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION,
  promptKey: MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION,
  defaultMode: 'agent',
  description: 'MindMap 拆解问题 Agent（创建子问题节点，禁止打标/挂证据）',

  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: mindmapToolManifest.agentTools.decomposeQuestion,
    knowledgeBaseId: 'default',
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
  },

  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default AGENT_DEFINITION;
