/** 侧栏对话行行首的运行状态；空闲不显示，不是这里的一种值。 */
export type ConversationRunStatus = 'running' | 'awaiting-answer' | 'awaiting-approval' | 'interrupted';

/** 收起的项目只显示里面最需要处理的一种。 */
export const CONVERSATION_RUN_STATUS_PRIORITY: readonly ConversationRunStatus[] = [
  'awaiting-approval',
  'awaiting-answer',
  'interrupted',
  'running',
];

/** “看过哪次中断”的展示记录，只影响红点，不改运行事实。 */
export interface ConversationInterruptionSeenRecord {
  /** 首次启用时刻；更早结束的中断一律算看过，避免上线就冒出一批旧红点。 */
  readonly baselineAt: number;
  /** 对话 → 看过的运行编号。 */
  readonly seenRunIds: Readonly<Record<string, string>>;
}

export interface ConversationRunStatusSummary {
  readonly status: ConversationRunStatus;
  readonly count: number;
}
