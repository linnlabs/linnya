/**
 * @file src/app-hosts/linnya/agent-registry/agents/deep_research/leader/index.ts
 * @description Deep Research Leader AgentDefinition
 */

import { PromptKeys } from '../../../prompt.types';
import { ConversationAgentIds } from '@app/schemas';
import type { AgentDefinition, AgentRegistryDependencies } from '../../../types';
import { buildPrompt } from '../../../prompt.builder';
import { DEEP_RESEARCH_LEADER_PROMPT } from './prompt';
import type { enrichment } from '@linnlabs/linnkit/runtime-kernel';
import { DeepResearchRequestEnricher } from '../deepResearch.enricher';
import { DEEP_RESEARCH_SYSTEM_REMINDER_RULE_IDS } from '../systemReminder';

type RequestEnricher = enrichment.RequestEnricher;

function createDeepResearchRequestEnricher(deps: AgentRegistryDependencies): RequestEnricher {
  return new DeepResearchRequestEnricher(deps.databaseService);
}

const DEEP_RESEARCH_INTEGRATIONS = {
  requestEnrichers: [createDeepResearchRequestEnricher],
} satisfies NonNullable<AgentDefinition['integrations']>;

const DEEP_RESEARCH_LEADER_TOOLS = [
  // Deep Research 协作产物是项目 VFS 中的正式 Markdown 文档。
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'tool_output_read',
  'ask',
  'search_in_knowledgebase',
  'knowledge_read',
  // 普通研究角色统一走 canonical subagent；最终写作由 Leader 读取正式 Workspace 文档后完成。
  'subagent',
  'write_report',
] as const;

function buildSystemPrompt(): string {
  return buildPrompt(DEEP_RESEARCH_LEADER_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。',
  });
}

function processResponse(rawResponse: string): string {
  return rawResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function processStreamChunk(chunk: string): string {
  if (chunk.includes('<think>') || chunk.includes('</think>')) return '';
  return chunk;
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: ConversationAgentIds.DEEP_RESEARCH,
  promptKey: PromptKeys.DEEP_RESEARCH_LEADER,
  defaultMode: 'agent',
  description: 'Deep Research Leader - 澄清问题、拆解子问题、制定检索计划与停止条件',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', keepLatestRuns: 2 },
      systemReminder: { enabledRuleIds: [...DEEP_RESEARCH_SYSTEM_REMINDER_RULE_IDS] },
    },
    enableTools: true,
    availableTools: DEEP_RESEARCH_LEADER_TOOLS,
    knowledgeBaseId: 'default',
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'reasoning',
    /** 最终报告必须通过 write_report 原子收口，避免生成工具结果后再次复述。 */
    stepPolicy: { kind: 'force_tools', forcedTools: ['write_report'], lastStepsHintThreshold: 3 },
    /**
     * 🔔 SystemReminder（按 Deep Research 子角色收口）
     *
     * 中文备注：
     * - Deep Research 子角色默认不具备 subagent 工具，因此禁用协作相关提醒；
     * - 仅保留步数收尾类提醒，避免噪音干扰计划/收敛。
     */
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
    responseProcessor: processResponse,
    streamChunkProcessor: processStreamChunk,
  },
  integrations: DEEP_RESEARCH_INTEGRATIONS,
};

export default AGENT_DEFINITION;
