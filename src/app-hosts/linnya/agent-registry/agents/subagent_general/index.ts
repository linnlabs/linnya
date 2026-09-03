/**
 * @file src/app-hosts/linnya/agent-registry/agents/subagent_general/index.ts
 *
 * @description
 * 通用子 Agent（subagent_general）定义：
 * - 专供 `subagent` 工具内部启动子 Agent 使用；
 * - 工具白名单/模型策略/步数策略在此处内聚，父 Agent 不可选择，保证稳定性。
 */

import type { AgentDefinition } from '../../types';
import { PromptKeys } from '../../prompt.types';
import { buildPrompt } from '../../prompt.builder';
import { SUBAGENT_GENERAL_PROMPT } from './prompt';

/**
 * 子任务 SubAgent 的工具白名单（稳定收敛版）
 *
 * 说明：
 * - 子 agent 的“搜索”必须使用浅搜索等价工具 `search_in_knowledgebase`，从 schema 层面根治递归 deep_search；
 * - 允许子 agent 直接创建/编辑文档（产物落地），减少父 agent 的二次搬运成本；
 * - 仍保持：任务状态工具不在白名单内（父子任务语义只通过委派 prompt 交接）。
 */
const SUBAGENT_GENERAL_TOOLS = [
  'tool_output_read',
  'list_files',
  'read_file',
  'grep',
  'edit_file',
  'write_file',
  // 知识库搜索保持独立：搜索是独立意图，不属于文件或 Evidence 阅读。
  'search_in_knowledgebase',
  'knowledge_read',
  'web_search',
  'web_read',
  // Skill（渐进式能力披露：按需加载领域知识与工作流指导）
  'skill',
  'shell',
  'process',
] as const;

function buildSystemPrompt(): string {
  // 目前不依赖 request 的动态变量，保持完全确定性。
  return buildPrompt(SUBAGENT_GENERAL_PROMPT, {
  });
}

export const SUBAGENT_GENERAL_AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.SUBAGENT_GENERAL,
  promptKey: PromptKeys.SUBAGENT_GENERAL,
  defaultMode: 'agent',
  description: '通用子任务 SubAgent（subagent 工具内部使用）',
  config: {
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', keepLatestRuns: 2 },
      systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
    },
    enableTools: true,
    availableTools: SUBAGENT_GENERAL_TOOLS,
    skill: {
      enabled: true,
    },
    knowledgeBaseId: 'default',
    // 步数预算属于 Agent 产品策略；通用 subagent 工具不得用私有常量覆盖。
    maxSteps: 60,
    // 通用子 Agent 沿用父 run 已选定的模型；调用方显式指定 modelId 时仍可覆盖。
    // 专用子 Agent 的 fixed 策略不受影响，避免把继承规则扩散成全局行为。
    modelPolicy: { kind: 'inherit_parent' },
    preferredModelCapability: 'tool_calling',
    /**
     * MaxSteps 收尾提示策略（通用子 Agent）
     *
     * 中文备注：
     * - subagent_general 的工作类型跨度很大：可能纯研究，也可能创建/编辑 Workspace 文档；
     * - 它不像 deep_research 角色那样有“尾段必须调用某个固定工具”的稳定闭环；
     * - 因此这里只做最后几步提醒，提示模型停止发散搜索/递归尝试，转向收尾并输出结论。
     */
    stepPolicy: {
      kind: 'final_answer',
      /**
       * 中文备注：
       * - 这里的步数口径是 GraphExecutor 的节点切换次数；
       * - 提前 12 次切换开始提醒，约等于还剩 6 次 LLM→Tool 级别操作，足够模型收敛。
       */
      lastStepsHintThreshold: 12,
    },
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default SUBAGENT_GENERAL_AGENT_DEFINITION;
