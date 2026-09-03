/**
 * @file MindMap Validate Hypothesis Agent 定义
 *
 * 中文说明：
 * - 专用于“验证假设”（右键 hypothesis 节点入口）
 * - 工具集收敛到：读结构 + MindMap 打标/挂证据 +（可选）知识库搜索
 */
import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { MINDMAP_VALIDATE_HYPOTHESIS_PROMPT } from './prompt.js';
import { mindmapToolManifest } from '../../../tools/mindmap';

function buildSystemPrompt(): string {
  return buildPrompt(MINDMAP_VALIDATE_HYPOTHESIS_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。',
  });
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: MindmapPromptKeys.MINDMAP_VALIDATE_HYPOTHESIS,
  promptKey: MindmapPromptKeys.MINDMAP_VALIDATE_HYPOTHESIS,
  defaultMode: 'agent',
  description: 'MindMap 验证假设 Agent（搜证据→挂证据→打标）',

  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: mindmapToolManifest.agentTools.validateHypothesis,
    knowledgeBaseId: 'default',
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
  },

  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default AGENT_DEFINITION;
