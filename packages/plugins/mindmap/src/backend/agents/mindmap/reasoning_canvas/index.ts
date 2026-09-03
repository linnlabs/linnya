/**
 * @file MindMap Reasoning Canvas Agent 定义
 *
 * 中文说明：
 * - 该 Agent 专为 MindMap（Issue Tree / 推理画布）场景设计
 * - 工具集收缩：只包含读取、MindMap 专用工具、知识库搜索
 * - 禁止文档写作/修订工具
 *
 * @see packages/plugins/mindmap/src/renderer/docs/README.md
 */

import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import type { AgentDefinition } from '@plugin/backend/agentRegistry';
import { buildPrompt } from '@plugin/backend/agentRegistry';
import { MINDMAP_REASONING_CANVAS_PROMPT } from './prompt.js';
import { mindmapToolManifest } from '../../../tools/mindmap';

/**
 * 构建系统提示词
 */
function buildSystemPrompt(): string {
  return buildPrompt(MINDMAP_REASONING_CANVAS_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。',
  });
}

/**
 * MindMap Reasoning Canvas Agent 定义
 */
export const AGENT_DEFINITION: AgentDefinition = {
  id: MindmapPromptKeys.MINDMAP_REASONING_CANVAS,
  promptKey: MindmapPromptKeys.MINDMAP_REASONING_CANVAS,
  defaultMode: 'agent',
  description: 'MindMap 推理画布 Agent（假设验证、打标、挂证据）',

  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: mindmapToolManifest.agentTools.reasoningCanvas,
    knowledgeBaseId: 'default',
    // 使用用户选择的主模型
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
  },

  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default AGENT_DEFINITION;
