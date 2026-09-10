import type Database from 'better-sqlite3';

export interface PurgeStaleAuditEventsOptions {
  readonly olderThanMs: number;
  readonly nowMs?: number;
}

/**
 * 只清理过期的隐藏 Agent Run Audit 事实，不删除任何普通 RuntimeEvent。
 *
 * 中文备注：审计事件没有独立表，保留在 events 事实源中；因此清理必须显式限定
 * `type = audit_envelope`，不能按 run/conversation 的普通事实策略误删用户历史。
 */
export function purgeStaleAuditEvents(
  db: Database.Database,
  options: PurgeStaleAuditEventsOptions,
): number {
  if (!Number.isFinite(options.olderThanMs) || options.olderThanMs < 0) {
    throw new Error('Audit retention window must be a non-negative finite number');
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error('Audit maintenance nowMs must be finite');
  }

  return db
    .prepare(
      `DELETE FROM events
       WHERE type = 'audit_envelope' AND ts < ?`,
    )
    .run(nowMs - options.olderThanMs).changes;
}
