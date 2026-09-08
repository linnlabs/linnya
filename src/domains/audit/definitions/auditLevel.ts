import { z } from 'zod';

/**
 * Linnya 的唯一审计记录等级。
 *
 * `minimal`、`standard` 和 `debug` 只改变“记录哪些审计事实”，不改变审计
 * 事实的存储 owner。所有等级最终都经过同一个 AuditPort。
 */
export const AuditLevelSchema = z.enum(['minimal', 'standard', 'debug']);
export type AuditLevel = z.infer<typeof AuditLevelSchema>;

export const DEFAULT_AUDIT_LEVEL: AuditLevel = 'standard';

/** 只有这些动作在 minimal 等级仍然保留。 */
const MINIMAL_AUDIT_ACTION_PREFIXES = [
  'command.',
  'run.',
  'model.fallback',
  'tool.allow',
  'tool.deny',
  'tool.protocol_error',
  'wait_user.',
  'sandbox.',
] as const;

/** `llm.*` 预留给体积较大的开发诊断证据，不允许写入 EventStore。 */
export function isDebugEvidenceAction(action: string): boolean {
  return action.startsWith('llm.');
}

export function isAuditActionEnabled(level: AuditLevel, action: string): boolean {
  if (isDebugEvidenceAction(action)) return level === 'debug';
  if (level !== 'minimal') return true;
  return MINIMAL_AUDIT_ACTION_PREFIXES.some(prefix => action.startsWith(prefix));
}
