import { AuditLevelSchema, DEFAULT_AUDIT_LEVEL, type AuditLevel } from '../definitions/auditLevel';

/**
 * 解析当前进程的统一审计开关。
 *
 * `LINNYA_LLM_RUN_AUDIT` 不再是有效入口。debug 审计包含上下文和协议诊断，
 * 因此在非开发进程中强制降级为 standard，避免生产环境通过一个环境变量写入
 * 大体积模型输入快照。
 */
export function resolveAuditLevel(environment: NodeJS.ProcessEnv = process.env): AuditLevel {
  const parsed = AuditLevelSchema.safeParse(environment.LINNYA_AUDIT_LEVEL?.trim().toLowerCase());
  const requested = parsed.success ? parsed.data : DEFAULT_AUDIT_LEVEL;
  if (requested === 'debug' && environment.LINNYA_DEV_MODE !== 'true') return 'standard';
  return requested;
}
