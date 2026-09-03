/**
 * @file MindMap Propose Hypothesis Agent 定义
 *
 * 中文说明：
 * - 该 Agent 用于“提出假设”（右键 question / hypothesis 节点）
 * - 工具集严格收缩：读结构 + 创建子假设节点
 * - 禁止打标/挂证据（避免混入验证闭环）
 */
import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { MINDMAP_PROPOSE_HYPOTHESIS_PROMPT } from './prompt.js';
import { mindmapToolManifest } from '../../../tools/mindmap';

function buildSystemPrompt(): string {
  return buildPrompt(MINDMAP_PROPOSE_HYPOTHESIS_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。',
  });
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: MindmapPromptKeys.MINDMAP_PROPOSE_HYPOTHESIS,
  promptKey: MindmapPromptKeys.MINDMAP_PROPOSE_HYPOTHESIS,
  defaultMode: 'agent',
  description: 'MindMap 提出假设 Agent（创建子假设节点，禁止打标/挂证据）',

  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: mindmapToolManifest.agentTools.proposeHypothesis,
    knowledgeBaseId: 'default',
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
  },

  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default AGENT_DEFINITION;
