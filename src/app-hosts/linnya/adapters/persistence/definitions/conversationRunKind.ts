/**
 * conversation `runs.kind` 的耐久协议。
 *
 * `user_input` 表示 Host 提交用户输入事实的写入批次；`agent` 表示由
 * RunSupervisor 管理的 Agent 执行。该分类与产品 task、工具名和 run status 无关。
 */
export const CONVERSATION_RUN_KIND = {
  USER_INPUT: 'user_input',
  AGENT: 'agent',
} as const;

export type ConversationRunKind = typeof CONVERSATION_RUN_KIND[keyof typeof CONVERSATION_RUN_KIND];
