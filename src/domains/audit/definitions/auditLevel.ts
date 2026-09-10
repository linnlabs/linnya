import { z } from 'zod';

/**
 * Linnya 的唯一 Agent Run Audit 记录等级。
 *
 * 等级只改变“记录哪些审计事实”，不改变审计入口或查询合同。高等级包含低等级
 * 的结构化事实，但会额外记录上游响应摘要或流式诊断材料，因此必须有更严格的
 * 开发环境、容量和保留门禁。
 */
export const AuditLevelSchema = z.enum(['off', 'behavior', 'response', 'stream']);
export type AuditLevel = z.infer<typeof AuditLevelSchema>;

/** 开发进程也默认关闭，避免高体积审计被意外长期开启。 */
export const DEFAULT_AUDIT_LEVEL: AuditLevel = 'off';

/** behavior 等级保留的 Agent 行为和决策事实。 */
const BEHAVIOR_AUDIT_ACTION_PREFIXES = [
  'command.',
  'run.',
  'model.',
  'model.fallback',
  'tool.',
  'tool.allow',
  'tool.deny',
  'tool.protocol_error',
  'wait_user.',
  'sandbox.',
] as const;

/** `llm.*` 保留给上游响应摘要和受限流式诊断证据，由等级决定是否写入。 */
export function isLlmEvidenceAction(action: string): boolean {
  return action.startsWith('llm.');
}

/** response 等级只接纳已经安全投影的上游响应摘要，不接纳上下文全文。 */
export function isUpstreamResponseAction(action: string): boolean {
  return action.startsWith('llm.response.') || action.startsWith('llm.usage.');
}

export function isAuditActionEnabled(level: AuditLevel, action: string): boolean {
  if (level === 'off') return false;
  if (isLlmEvidenceAction(action)) {
    return level === 'stream' || (level === 'response' && isUpstreamResponseAction(action));
  }
  if (level === 'behavior') {
    return BEHAVIOR_AUDIT_ACTION_PREFIXES.some(prefix => action.startsWith(prefix));
  }
  return true;
}
