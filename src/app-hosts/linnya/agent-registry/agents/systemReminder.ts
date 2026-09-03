/**
 * @file src/app-hosts/linnya/agent-registry/agents/systemReminder.ts
 * @description Linnya Agent 的 SystemReminder 规则配置
 *
 * 中文备注：
 * - TaskState、Workspace 都是 Linnya host/product 语义；
 * - linnkit 只提供 trigger/template 解释能力，不内置这些业务文案；
 * - 只有实际具备对应工具的 agent 才应启用这些规则，避免提醒模型调用不可用能力。
 */

import type { AgentSpecSystemReminderExtraRule, AgentSpecSystemReminderPolicy } from '@linnlabs/linnkit/contracts';

export const LINNYA_DEFAULT_SYSTEM_REMINDER_RULE_IDS = [
  'max_steps_force_final_answer',
  'last_steps_hint',
  'tool_call_streak_every_ten',
  'linnya_periodic_taskstate_reflection',
] as const;

export const LINNYA_TASKSTATE_SYSTEM_REMINDER_EXTRA_RULES: readonly AgentSpecSystemReminderExtraRule[] = [
  {
    id: 'linnya_periodic_taskstate_reflection',
    trigger: { kind: 'step-count-modulo', period: 30, minStep: 30 },
    contentTemplate: 'hostReminderText',
    contentArgs: {
      lines: [
        '你已执行了一段较长流程。请暂停当前工作，花一步反思和整理：',
        '1. 回顾你最近的 task_write 输出，确认当前工作方向正确（没有偏离 Goal）。',
        '2. 调用 task_write 更新 progress 和 next_steps，如有必要调整 current_plan。',
        '3. 如果任务复杂但尚未创建 TaskState，现在是创建的好时机。',
        '完成整理后继续执行任务。',
      ],
    },
  },
] as const;

export const LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY: AgentSpecSystemReminderPolicy = {
  enabledRuleIds: [...LINNYA_DEFAULT_SYSTEM_REMINDER_RULE_IDS],
  thresholds: {
    toolCallStreak: 10,
    lastStepsHintThreshold: 0,
  },
  extraRules: [...LINNYA_TASKSTATE_SYSTEM_REMINDER_EXTRA_RULES],
};
