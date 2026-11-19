/** 探针实例回收的判定规则：纯函数，不读文件、不查进程，事实由 orchestration 采集后传入。 */

export const DAY_MS = 86_400_000;
/** 已停止实例超过这个天数没人用就自动回收。 */
export const DEFAULT_PRUNE_DAYS = 3;
/** 被回收实例的 artifacts（截图与验收证据）归档保留的天数。 */
export const ARTIFACT_ARCHIVE_DAYS = 30;
/** 看管进程发布启动身份前的交接窗口，与 `up` 的交接检查一致。 */
export const SUPERVISOR_HANDOFF_MS = 45_000;
/** 没有实例目录的 `*.lock.sqlite` 至少这么久没动才清，避开正在创建锁文件的 `up`。 */
export const ORPHAN_LOCK_MIN_AGE_MS = 10 * 60_000;
/** 共享的构建锁文件名（`build.lock.sqlite`）。它不属于任何实例目录，永远保留。 */
export const SHARED_LOCK_NAMES = Object.freeze(['build']);

/** 会话记录里登记过的所有进程身份：看管器、Desktop、Vite 以及已确认的子进程。 */
export function recordedProcesses(session) {
  return [session?.supervisor, session?.electron, session?.vite, ...(session?.processes ?? [])].filter(Boolean);
}

/**
 * 最近一次使用的时间：最后使用标记、停止时间和启动时间里最晚的一个。
 * 都没有时（空目录）退回到目录自身的修改时间。
 */
export function lastUsedAt({ lastUsedMtimeMs, session, directoryMtimeMs }) {
  const candidates = [lastUsedMtimeMs, session?.stoppedAt, session?.startedAt]
    .filter(value => Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : directoryMtimeMs;
}

/** 其他进程的命令行里带着实例目录路径（例如 `--user-data-dir=<实例>/user-data`），说明它仍在使用该实例。 */
export function processesReferencingRoot(table, root, selfPid) {
  const prefix = `${root}/`;
  return [...table.values()]
    .filter(entry => entry.pid !== selfPid && (entry.command.includes(prefix) || entry.command.endsWith(root)))
    .map(entry => entry.pid);
}

/**
 * 判断一个已取得生命周期锁的实例能否回收。
 * `liveRecorded` 是会话里仍存活（身份一致）的进程，`referencing` 是命令行指向该实例的进程。
 * 返回 `{ prune, reason }`；不回收时 reason 说明原因，供 `prune` 输出。
 */
export function judgeInstancePrune({ idleMs, olderThanMs, session, liveRecorded, referencing, now }) {
  if (liveRecorded.length || referencing.length) return { prune: false, reason: 'running' };
  if (session?.state === 'starting' && !session.supervisor && now - session.startedAt < SUPERVISOR_HANDOFF_MS) {
    return { prune: false, reason: 'starting' };
  }
  if (idleMs <= olderThanMs) return { prune: false, reason: 'recent' };
  return { prune: true, reason: 'stopped-idle' };
}

/** 归档目录里的一项是否已过保留期。 */
export function isArchiveExpired({ mtimeMs, now, retentionDays = ARTIFACT_ARCHIVE_DAYS }) {
  return now - mtimeMs > retentionDays * DAY_MS;
}

/** 没有实例目录的锁文件能否清理（是否还有人持锁由 orchestration 用锁本身判断）。 */
export function isOrphanLockStale({ name, hasInstanceDirectory, mtimeMs, now }) {
  if (SHARED_LOCK_NAMES.includes(name) || hasInstanceDirectory) return false;
  return now - mtimeMs > ORPHAN_LOCK_MIN_AGE_MS;
}

/** 归档目录名：`<实例名>-<日期>`，同一天再次回收同名实例时追加序号。 */
export function archiveEntryName(name, date, taken) {
  const base = `${name}-${date}`;
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    if (!taken.has(`${base}-${index}`)) return `${base}-${index}`;
  }
}
