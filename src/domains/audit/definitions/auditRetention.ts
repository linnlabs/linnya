/**
 * Agent Run Audit 的默认数据库保留窗口。
 *
 * 审计只在开发环境显式开启；按时间清理只删除隐藏 audit_envelope，不触碰
 * Conversation RuntimeEvent、RunRegistry 或用户内容历史。该策略固定在代码中，
 * 不开放第二个环境变量入口，避免各个宿主使用不同的保留语义。
 */
export const AGENT_RUN_AUDIT_RETENTION_DAYS = 7;
export const AGENT_RUN_AUDIT_RETENTION_MS =
  AGENT_RUN_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
