/**
 * @file src/app-hosts/linnya/agent-registry/agents/deep_research/systemReminder.ts
 * @description Deep Research 子角色的 SystemReminder 规则配置（集中收口）
 *
 * 中文备注（根因级说明）：
 * - Leader 自己编排 subagent，普通研究子角色不再递归委派；
 * - 各角色都不需要通用默认 Agent 的委派频率提醒；
 * - 这里只保留与步数收尾相关的提醒，降低噪音，避免干扰角色收敛。
 */

export const DEEP_RESEARCH_SYSTEM_REMINDER_RULE_IDS = [
  'max_steps_force_final_answer',
  'last_steps_hint',
] as const;
