import { AuditLevelSchema, type AuditLevel } from '../definitions/auditLevel';

export function readAuditLevelSnapshot(value: unknown): AuditLevel {
  // 旧 run 未接纳过审计策略，恢复也不得因当前默认开启而补录半截记录。
  return value === undefined ? 'off' : AuditLevelSchema.parse(value);
}
