/** 审计仅允许在显式开启的开发环境中写盘。 */
export function isLLMRunAuditEnabled(): boolean {
  if (process.env.LINNYA_DEV_MODE !== 'true') return false;
  const value = process.env.LINNYA_LLM_RUN_AUDIT;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function getSystemReminderAuditMaxEntriesPerRunKey(): number {
  return parsePositiveIntEnv('LINNYA_LLM_RUN_AUDIT_REMINDER_MAX_ENTRIES_PER_RUNKEY') ?? 16;
}

export function getToolProtocolErrorAuditMaxEntriesPerRunKey(): number {
  return parsePositiveIntEnv('LINNYA_LLM_RUN_AUDIT_PROTOCOL_ERROR_MAX_ENTRIES_PER_RUNKEY') ?? 16;
}

function parsePositiveIntEnv(name: string): number | null {
  const raw = typeof process.env[name] === 'string' ? process.env[name]!.trim() : '';
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}
