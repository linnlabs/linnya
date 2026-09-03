/**
 * @file src/electron-main/services/quota/quotaRegistry.ts
 *
 * @description
 * QuotaManager 的单例与默认策略注册入口。
 *
 * 中文说明：
 * - 所有配额策略统一在这里注册，避免散落在各个 IPC / 业务模块中；
 * - 未来新增配额：只需在此处添加一个 policy（高内聚低耦合）。
 */

import { QuotaManager, type QuotaState } from './quotaManager.js';
import { store } from '../../store/index.js';

// 单例（主进程内共享）
export const quotaManager = new QuotaManager();

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 兼容迁移：旧的 deep-research 存储 key -> 新的 quota storeKey
 *
 * 中文说明（根因级）：
 * - 我们从“专用 deep-research storeKey”迁移到了“通用 quota storeKey”；
 * - 若不迁移，升级后用户的配额会被意外重置，这违反阶段0的目标；
 * - 因此在注册策略时做一次性迁移（仅当新 key 尚不存在时）。
 */
function migrateLegacyDeepResearchQuotaIfNeeded(): void {
  const legacyKey = 'deep-research.weekly-quota.v1';
  const newKey = 'quota.deep_research.iso_week.v1';

  const existingNew = store.get(newKey);
  if (existingNew !== undefined) return;

  const legacyRaw = store.get(legacyKey);
  if (!isRecord(legacyRaw)) return;

  const weekKey = legacyRaw['weekKey'];
  const usedCount = legacyRaw['usedCount'];
  const updatedAt = legacyRaw['updatedAt'];
  if (typeof weekKey !== 'string' || weekKey.trim().length === 0) return;
  if (typeof usedCount !== 'number' || !Number.isFinite(usedCount) || usedCount < 0) return;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return;

  const migrated: QuotaState = {
    windowKey: weekKey,
    usedCount,
    updatedAt,
  };
  store.set(newKey, migrated);
}

/**
 * 注册内置的配额策略
 *
 * 约定：
 * - quotaId 使用 snake_case，便于跨端/日志/埋点统一
 */
export function registerBuiltinQuotaPolicies(): void {
  migrateLegacyDeepResearchQuotaIfNeeded();

  // Deep Research：每周 3 次（ISO week）
  quotaManager.registerPolicy({
    quotaId: 'deep_research',
    windowType: 'iso_week',
    limit: 3,
    storeKey: 'quota.deep_research.iso_week.v1',
  });
}

