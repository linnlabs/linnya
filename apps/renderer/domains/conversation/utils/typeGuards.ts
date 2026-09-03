import type { ActivityBinding } from '../types';

/**
 * @description
 * 统一的类型守卫与基础判定工具。
 *
 * 设计目标：
 * - **可复用**：UI 与投影器等多个模块需要一致的 guard，避免重复实现；
 * - **严格类型**：不使用 any，不做随意断言，通过守卫逐步收敛类型；
 * - **高内聚**：这里只放“通用且稳定”的 guard，不放业务逻辑。
 */

export type UnknownRecord = Record<string, unknown>;

/**
 * 判断一个值是否为普通对象（非数组）。
 */
export function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 判断一个 unknown 是否符合 ActivityBinding 协议。
 *
 * 约束：
 * - runId / feature 必须是非空字符串
 */
export function isActivityBinding(v: unknown): v is ActivityBinding {
  if (!isRecord(v)) return false;
  if (typeof v.runId !== 'string' || v.runId.length === 0) return false;
  if (typeof v.feature !== 'string' || v.feature.length === 0) return false;

  return true;
}

