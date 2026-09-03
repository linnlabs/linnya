/**
 * @file src/app-hosts/linnya/agent-registry/agents/deep_search/index.ts
 * @description Deep Search Agent 定义
 *
 * 说明：
 * - AgentRegistry 不承载“对外暴露”语义；该 agent 会像其它 platform agent 一样由 platform contribution 贡献
 * - 工具白名单仅包含 3 个工具：浅搜索、阅读、结果物化（用于约束调用能力边界）
 */

import type { AgentDefinition } from '../../types';
import { buildPrompt } from '../../prompt.builder';
import { PromptKeys } from '../../prompt.types';
import { DEEP_SEARCH_AGENT_PROMPT, DEEP_SEARCH_PROMPT_KEY } from './prompt';
import { CLOUD_DEEPSEEK_CHAT_MODEL_ID } from 'src/domains/model-catalog';

/**
 * Deep Search Agent 工具白名单（严格限制）
 *
 * 说明：
 * - search_in_knowledgebase: 浅搜索工具（不暴露 deep_search 参数，根本避免递归）
 * - knowledge_read: 阅读文档内容
 * - assemble_documents: 结果组装工具（接收子 Agent 已筛选的 doc_id+block_id，输出结构化 kept）
 */
const DEEP_SEARCH_AGENT_TOOLS = [
  'search_in_knowledgebase',
  'knowledge_read',
  'assemble_documents',
] as const;

/**
 * Deep Search Agent 配置常量
 */
export const DEEP_SEARCH_CONFIG = {
  /** 子 Agent 最大步数（防止无限循环） */
  // 🔥 注意：maxSteps 统计的是“节点切换次数”，一次工具调用往往会消耗多次切换（llm→tool→llm...）
  MAX_STEPS: 30,
  /** 初始召回数量 */
  // 经验值：过大的初始召回会显著增加噪音与输出体积；默认收敛为 10，仍保留足够覆盖面供子 Agent 多轮检索。
  CANDIDATE_TOP_K: 10,
  /** 最终输出数量 */
  FINAL_TOP_K: 10,
} as const;

function buildSystemPrompt(): string {
  return buildPrompt(DEEP_SEARCH_AGENT_PROMPT, {
  });
}

/**
 * Deep Search Agent Definition
 */
export const DEEP_SEARCH_AGENT_DEFINITION: AgentDefinition = {
  id: DEEP_SEARCH_PROMPT_KEY,
  promptKey: PromptKeys.DEEP_SEARCH,
  defaultMode: 'agent',
  description: 'Deep Search Agent（知识库深度搜索）',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', keepLatestRuns: 2 },
      systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
    },
    enableTools: true,
    availableTools: DEEP_SEARCH_AGENT_TOOLS,
    /**
     * 🔥 工具内部 Deep Search 的默认驱动模型（后端指定）
     *
     * 说明：
     * - deep_search 是工具内部拉起的子 Agent，要求“稳定可工具调用 + 成本可控”；
     * - 因此默认固定为云端 DeepSeek 非思考模型（`cloud-deepseek-chat`）；
     * - 工具内部调用不会继承父 Agent 模型，也不会在底层自动切到其它模型；
     * - 只有调用方通过 child-run executionPolicy 显式传入 modelId 时，才允许覆盖。
     */
    // ✅ deep_search 是工具内部子 Agent：必须固定模型（避免用户主模型影响成本与工具能力）
    modelPolicy: { kind: 'fixed', modelId: CLOUD_DEEPSEEK_CHAT_MODEL_ID },
    // 不需要知识库 ID，由父 Agent 传递上下文
    preferredModelCapability: 'tool_calling',
    // 收尾策略：主产物来自 assemble_documents；在仍能执行 ToolNode 时收缩到该最终工具。
    stepPolicy: {
      kind: 'force_tools',
      forcedTools: ['assemble_documents'],
      lastStepsHintThreshold: 3,
    },
    /**
     * 🔔 SystemReminder（子 Agent 定制）
     *
     * 中文备注：
     * - deep_search 是工具内部子 Agent，不具备 subagent 工具，因此不启用“发起协作”相关提醒；
     * - 仅保留与步数收尾相关的提醒，避免噪音干扰子 Agent 收敛。
     */
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
  // 无需 integrations，子 Agent 不走标准请求流程
};

export default DEEP_SEARCH_AGENT_DEFINITION;
