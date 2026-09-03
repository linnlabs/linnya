/**
 * @file versionRetention.ts
 * @description 版本表的剪裁策略（通用）。
 *
 * 中文说明（根因）：
 * - 我们的 workspace DB 采用“*_versions 表 + 每次保存 INSERT 一行”的版本化存储；
 * - 如果不做剪裁，版本数会随保存次数单调增长，最终带来 SQLite 文件膨胀与查询性能下降；
 * - 但我们又需要保留一定的历史快照用于未来可能的恢复/审计，并且必须保留最近版本用于读取。
 *
 * 因此这里提供一个确定性的“保留集合计算 + 删除其余版本”的通用实现：
 * - 保留最早版本（可选）
 * - 保留最近 N 个版本（强保留）
 * - 对更早的版本：按时间桶（每 K 天一个桶）保留每桶的“最新一版”，最多保留 M 个桶（稀疏快照）
 */

import type Database from 'better-sqlite3';

export interface VersionRetentionPolicy {
  /** 是否保留最早版本（通常建议保留：对齐“最初创建”的锚点） */
  keepFirst: boolean;
  /** 强保留最近 N 个版本 */
  keepRecent: number;
  /**
   * 对早期版本做“稀疏快照保留”的桶大小（天）。
   * - 例如 bucketDays=3：表示每 3 天一个桶，桶内仅保留“最新一版”。
   */
  sparseBucketDays: number;
  /**
   * 允许保留的“稀疏快照桶”数量上限（从新到旧取最近的若干桶）。
   * - 例如 keepSparseBuckets=5：额外保留 5 个时间桶的快照。
   */
  keepSparseBuckets: number;
}

export interface VersionRowLite {
  versionNumber: number;
  createdAt: number;
}

export interface PrunePlan {
  keep: number[];
  remove: number[];
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数，实际为: ${value}`);
  }
}

/**
 * 计算需要保留/删除的版本号列表（纯函数）。
 */
export function computePrunePlan(rows: VersionRowLite[], policy: VersionRetentionPolicy): PrunePlan {
  assertNonNegativeInt('keepRecent', policy.keepRecent);
  assertNonNegativeInt('sparseBucketDays', policy.sparseBucketDays);
  assertNonNegativeInt('keepSparseBuckets', policy.keepSparseBuckets);

  if (rows.length === 0) return { keep: [], remove: [] };

  // 按 versionNumber 升序
  const sorted = [...rows].sort((a, b) => a.versionNumber - b.versionNumber);
  const first = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;

  const keepSet = new Set<number>();

  // 1) 保留最早
  if (policy.keepFirst) {
    keepSet.add(first.versionNumber);
  }

  // 2) 保留最近 N 个版本（按 versionNumber）
  const recentN = policy.keepRecent;
  if (recentN > 0) {
    const minKeep = Math.max(1, latest.versionNumber - recentN + 1);
    for (const r of sorted) {
      if (r.versionNumber >= minKeep) {
        keepSet.add(r.versionNumber);
      }
    }
  } else {
    // keepRecent=0 的极端情况：仍必须保留最新版本，否则读取会失效
    keepSet.add(latest.versionNumber);
  }

  // 3) 稀疏快照：对“非 recent”的版本按时间桶取每桶最新一版
  const bucketDays = policy.sparseBucketDays;
  const maxBuckets = policy.keepSparseBuckets;

  if (bucketDays > 0 && maxBuckets > 0) {
    // recent 边界：小于该版本号的视为“早期历史”
    const recentMin = (() => {
      const recent = policy.keepRecent;
      if (recent > 0) return Math.max(1, latest.versionNumber - recent + 1);
      return latest.versionNumber; // keepRecent=0 时 recentMin=latest，仅剩“早期”为空
    })();

    const bucketMs = bucketDays * 24 * 60 * 60 * 1000;
    // bucketKey -> 该桶保留的“最新版本号”（越大越新）
    const bucketToLatest = new Map<number, number>();

    for (const r of sorted) {
      if (r.versionNumber >= recentMin) continue; // recent 已强保留
      // 也跳过 first：避免 first 与稀疏策略重复争夺（保留 first 的语义更强）
      if (policy.keepFirst && r.versionNumber === first.versionNumber) continue;

      const key = Math.floor(r.createdAt / bucketMs);
      const existing = bucketToLatest.get(key);
      if (existing === undefined || r.versionNumber > existing) {
        bucketToLatest.set(key, r.versionNumber);
      }
    }

    // 从新到旧，最多保留 maxBuckets 个桶
    const keys = Array.from(bucketToLatest.keys()).sort((a, b) => b - a);
    const chosen = keys.slice(0, maxBuckets);
    for (const k of chosen) {
      const v = bucketToLatest.get(k);
      if (typeof v === 'number') keepSet.add(v);
    }
  }

  const keep = Array.from(keepSet).sort((a, b) => a - b);
  const remove: number[] = [];
  for (const r of sorted) {
    if (!keepSet.has(r.versionNumber)) remove.push(r.versionNumber);
  }
  return { keep, remove };
}

/**
 * 对版本表执行剪裁（有副作用）。
 *
 * 注意：
 * - tableName / columnName 仅用于内部调用（由服务层传入固定常量），禁止拼接用户输入。
 */
export function pruneVersionTable(params: {
  db: Database.Database;
  /** 调用方 owner 传入自己持有的固定版本表名；不得来自用户输入。 */
  tableName: string;
  nodeIdColumn: 'node_id';
  versionColumn: 'version_number';
  createdAtColumn: 'created_at';
  nodeId: string;
  policy: VersionRetentionPolicy;
}): { kept: number; removed: number } {
  const { db, tableName, nodeIdColumn, versionColumn, createdAtColumn, nodeId, policy } = params;

  const stmt = db.prepare(
    `SELECT ${versionColumn} as versionNumber, ${createdAtColumn} as createdAt
     FROM ${tableName}
     WHERE ${nodeIdColumn} = ?
     ORDER BY ${versionColumn} ASC`
  );

  const rowsRaw = stmt.all(nodeId) as Array<{ versionNumber: number; createdAt: number }>;
  const rows: VersionRowLite[] = rowsRaw
    .filter((r) => typeof r.versionNumber === 'number' && typeof r.createdAt === 'number')
    .map((r) => ({ versionNumber: r.versionNumber, createdAt: r.createdAt }));

  const plan = computePrunePlan(rows, policy);
  if (plan.remove.length === 0) {
    return { kept: plan.keep.length, removed: 0 };
  }

  const deleteStmt = db.prepare(
    `DELETE FROM ${tableName} WHERE ${nodeIdColumn} = ? AND ${versionColumn} = ?`
  );

  const removeVersions = () => {
    let removed = 0;
    for (const v of plan.remove) {
      const res = deleteStmt.run(nodeId, v);
      removed += typeof res.changes === 'number' ? res.changes : 0;
    }
    return removed;
  };

  const removedCount = db.inTransaction ? removeVersions() : db.transaction(removeVersions)();
  return { kept: plan.keep.length, removed: removedCount };
}
