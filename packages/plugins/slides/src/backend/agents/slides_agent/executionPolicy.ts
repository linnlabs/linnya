import type { AgentConfiguration } from '@plugin/backend/agentRegistry';

/** Slides 的阶段复核属于插件策略；通用 Runtime 只负责触发与瞬态注入。 */
export const SLIDES_CONTEXT_POLICY: AgentConfiguration['contextPolicy'] = {
  profileId: 'agent',
  toolHistory: { strategy: 'per-run', keepLatestRuns: 2 },
  systemReminder: {
    enabledRuleIds: [
      'max_steps_force_final_answer',
      'last_steps_hint',
      'tool_call_streak_every_ten',
      'slides_phase_checkpoint',
    ],
    extraRules: [{
      id: 'slides_phase_checkpoint',
      trigger: { kind: 'step-count-modulo', period: 20, minStep: 20 },
      contentTemplate: 'hostReminderText',
      contentArgs: {
        lines: [
          'Slides 阶段复核：先对照最近 task_write 的完成条件，再决定下一批动作。',
          '用已有结果更新 task_write：当前阶段（调研/建稿/验收）、已完成页数、当前 versionId、已检查页范围、未解决的 P0/P1 和下一批动作。不要为复述进度重新读取相同素材。',
          '比较最近两轮同范围检查的实际问题：若问题未减少且没有新增完成页，不得继续相同微调；重新定位根因，合并关联改动。连续三轮无进展时保留可用文稿，说明具体阻碍与未完成项后结束，不宣称完成。',
          '进入验收后停止无依据的装饰改版。P2 根据像素与设计意图判断，不机械清零；完成最终版本全页检查后立即交付。',
        ],
      },
    }],
  },
};

// 留出分批检查、一次合并修复和交付所需的收尾窗口；800 仍是复杂长稿的硬上限。
export const SLIDES_FINALIZATION_STEPS = 60;
