/**
 * @file src/app-hosts/linnya/agent-registry/agents/deep_research/scout/index.ts
 * @description Deep Research Scout AgentDefinition
 */

import { PromptKeys } from '../../../prompt.types';
import type { AgentDefinition, AgentRegistryDependencies } from '../../../types';
import { buildPrompt } from '../../../prompt.builder';
import { DEEP_RESEARCH_SCOUT_PROMPT } from './prompt';
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

const DEEP_RESEARCH_SCOUT_TOOLS = [
  // Deep Research 协作产物是项目 VFS 中的正式 Markdown 文档。
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'skill',
  'tool_output_read',
  'knowledge_search',
  'knowledge_read',
  // 按 canonical ref 复核搜索/阅读已经自动捕获的证据快照。
  'evidence_resolve',
] as const;

function buildSystemPrompt(): string {
  return buildPrompt(DEEP_RESEARCH_SCOUT_PROMPT, {
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
  id: PromptKeys.DEEP_RESEARCH_SCOUT,
  promptKey: PromptKeys.DEEP_RESEARCH_SCOUT,
  defaultMode: 'agent',
  description: 'Deep Research Scout - 多轮检索，收集候选文档与块 ID',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', keepLatestRuns: 2 },
      systemReminder: { enabledRuleIds: [...DEEP_RESEARCH_SYSTEM_REMINDER_RULE_IDS] },
    },
    enableTools: true,
    availableTools: DEEP_RESEARCH_SCOUT_TOOLS,
    skill: { enabled: true },
    knowledgeBaseId: 'default',
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
    /**
     * ✅ MaxSteps 收尾提示策略（声明式）
     *
     * 中文备注：
     * - Scout 的 prompt 要求通过 write_file 提交 `workspace:/research-scout-findings.md`；
     *   Knowledge 搜索/阅读会在返回前自动捕获 Agent 实际看见的 canonical refs。
     * - 若在 maxSteps 临界仍使用 final_answer，临界 LLM 会禁用工具，容易出现“DSML 伪工具调用文本”输出，
     *   导致产物未落盘、下游（Reasoner/Challenger/Writer）无法接力。
     * - 因此采用 force_tools：在仍能执行 ToolNode 时只允许 write_file，并由该工具完成落盘。
     */
    stepPolicy: {
      kind: 'force_tools',
      forcedTools: ['write_file'],
      /**
       * 中文备注：
       * - 这里的 lastStepsHintThreshold 口径是“节点切换次数”（GraphExecutor.remainingSteps），不是 UI 展示的“步数”；
       * - 一次工具调用通常需要 LLM→Tool→LLM 两次切换，因此 12 次节点切换约等于提前 6 步开始提醒收敛。
       */
      lastStepsHintThreshold: 12,
    },
    /**
     * 🔔 SystemReminder（按 Deep Research 子角色收口）
     *
     * 中文备注：
     * - Deep Research 子角色默认不具备 subagent 工具，因此禁用协作相关提醒；
     * - 仅保留步数收尾类提醒，避免噪音干扰检索/物化闭环。
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
