/**
 * @file src/electron-main/services/quota/quotaManager.ts
 *
 * @description
 * 通用配额管理器（QuotaManager）。
 *
 * 目标（中文）：
 * - 把“配额窗口（如周/日）+ 存储 + consume/get”收敛到一个地方
 * - 功能侧（Deep Research / 未来更多功能）只需要声明 policy（quotaId、limit、窗口算法）
 *
 * 设计约束：
 * - 不使用 any
 * - 所有从 electron-store 读取的结构都必须做校验（避免脏数据导致崩溃）
 */

import { store } from '../../store/index.js';
import { getIsoWeekKeyLocal, startOfNextIsoWeekLocal } from '../../../shared/utils/isoWeek.js';
import { QuotaPolicyNotFoundError } from '../../../features/system/quota/definitions/quotaErrors.js';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export type QuotaWindowType = 'iso_week';

export interface QuotaPolicy {
  /**
   * 配额ID：前端/IPC 会用它引用该配额
   * 示例：deep_research
   */
  quotaId: string;
  /**
   * 配额窗口类型
   * - iso_week: week_key=YYYY-WW，周一为周起始
   */
  windowType: QuotaWindowType;
  /**
   * 每个窗口内的上限
   */
  limit: number;
  /**
   * 存储 key（用于 electron-store 持久化）
   * 注意：必须带版本号，便于未来迁移
   */
  storeKey: string;
}

export interface QuotaState {
  windowKey: string;
  usedCount: number;
  updatedAt: number;
}

export interface QuotaInfo {
  success: true;
  quotaId: string;
  windowType: QuotaWindowType;
  windowKey: string;
  usedCount: number;
  limit: number;
  isExceeded: boolean;
  resetAt: number;
}

export interface QuotaConsumeInfo extends QuotaInfo {
  allowed: boolean;
}

function readQuotaState(raw: unknown): QuotaState | null {
  if (!isRecord(raw)) return null;
  const windowKey = raw['windowKey'];
  const usedCount = raw['usedCount'];
  const updatedAt = raw['updatedAt'];
  if (typeof windowKey !== 'string' || windowKey.trim().length === 0) return null;
  if (typeof usedCount !== 'number' || !Number.isFinite(usedCount) || usedCount < 0) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return { windowKey, usedCount, updatedAt };
}

function computeWindowKey(policy: QuotaPolicy, now: Date): string {
  if (policy.windowType === 'iso_week') {
    return getIsoWeekKeyLocal(now);
  }
  // 类型穷尽
  const _exhaustive: never = policy.windowType;
  return _exhaustive;
}

function computeResetAt(policy: QuotaPolicy, now: Date): number {
  if (policy.windowType === 'iso_week') {
    return startOfNextIsoWeekLocal(now).getTime();
  }
  const _exhaustive: never = policy.windowType;
  return _exhaustive;
}

function buildQuotaInfo(policy: QuotaPolicy, now: Date, state: QuotaState): QuotaInfo {
  const resetAt = computeResetAt(policy, now);
  const isExceeded = state.usedCount >= policy.limit;
  return {
    success: true,
    quotaId: policy.quotaId,
    windowType: policy.windowType,
    windowKey: state.windowKey,
    usedCount: state.usedCount,
    limit: policy.limit,
    isExceeded,
    resetAt,
  };
}

/**
 * QuotaManager：负责所有 quota policy 的注册与执行
 */
export class QuotaManager {
  private readonly policies = new Map<string, QuotaPolicy>();

  registerPolicy(policy: QuotaPolicy): void {
    const quotaId = policy.quotaId.trim();
    if (!quotaId) {
      throw new Error('QuotaPolicy.quotaId 不能为空');
    }
    if (!Number.isFinite(policy.limit) || policy.limit <= 0) {
      throw new Error(`QuotaPolicy.limit 不合法: ${policy.limit}`);
    }
    const storeKey = policy.storeKey.trim();
    if (!storeKey) {
      throw new Error('QuotaPolicy.storeKey 不能为空');
    }
    this.policies.set(quotaId, { ...policy, quotaId, storeKey });
  }

  getPolicy(quotaId: string): QuotaPolicy | null {
    const id = quotaId.trim();
    return this.policies.get(id) ?? null;
  }

  getQuotaInfo(quotaId: string, now: Date = new Date()): QuotaInfo {
    const policy = this.getPolicy(quotaId);
    if (!policy) throw new QuotaPolicyNotFoundError(quotaId);
    const state = this.getOrInitState(policy, now);
    return buildQuotaInfo(policy, now, state);
  }

  consume(quotaId: string, now: Date = new Date()): QuotaConsumeInfo {
    const policy = this.getPolicy(quotaId);
    if (!policy) throw new QuotaPolicyNotFoundError(quotaId);

    const state = this.getOrInitState(policy, now);
    if (state.usedCount >= policy.limit) {
      return { ...buildQuotaInfo(policy, now, state), allowed: false };
    }

    const next: QuotaState = {
      windowKey: state.windowKey,
      usedCount: state.usedCount + 1,
      updatedAt: Date.now(),
    };
    store.set(policy.storeKey, next);
    return { ...buildQuotaInfo(policy, now, next), allowed: true };
  }

  private getOrInitState(policy: QuotaPolicy, now: Date): QuotaState {
    const windowKey = computeWindowKey(policy, now);
    const existing = readQuotaState(store.get(policy.storeKey));
    if (existing && existing.windowKey === windowKey) {
      return existing;
    }
    const fresh: QuotaState = {
      windowKey,
      usedCount: 0,
      updatedAt: Date.now(),
    };
    store.set(policy.storeKey, fresh);
    return fresh;
  }
}
