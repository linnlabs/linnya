import { AuditLevelSchema, DEFAULT_AUDIT_LEVEL, type AuditLevel } from '../definitions/auditLevel';

export interface AuditRuntimeTrust {
  /** packaged 由已验证的 Host bootstrap facts 提供，不能由用户环境变量伪造。 */
  readonly packaged?: boolean;
}

/**
 * 解析当前进程的统一审计开关。
 *
 * `LINNYA_LLM_RUN_AUDIT` 不再是有效入口。Agent Run Audit 是开发诊断能力：
 * packaged 或明确的生产进程永远返回 `off`，不能靠 LINNYA_DEV_MODE 或审计环境变量
 * 绕过 Host 的发行身份策略。
 */
export function resolveAuditLevel(
  environment: NodeJS.ProcessEnv = process.env,
  trust: AuditRuntimeTrust = {},
): AuditLevel {
  if (trust.packaged === true || environment.NODE_ENV === 'production') return 'off';

  const parsed = AuditLevelSchema.safeParse(environment.LINNYA_AUDIT_LEVEL?.trim().toLowerCase());
  const requested = parsed.success ? parsed.data : DEFAULT_AUDIT_LEVEL;
  const isDevelopment =
    environment.LINNYA_DEV_MODE === 'true' || environment.NODE_ENV === 'development';
  if (!isDevelopment && requested !== 'off') return 'off';
  return requested;
}
