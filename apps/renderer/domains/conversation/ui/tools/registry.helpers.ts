/**
 * @file registry.helpers.ts
 * @description Tool UI Registry 通用工具函数
 *
 * 提供给各 configs/ 子模块使用的类型守卫、安全读取器。
 * 独立文件，避免在 registry.ts 和其它 helper 中重复定义。
 */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s.length > 0 ? s : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 解析 Vite env flag（严格、无 any）。
 *
 * 约定：以下值视为 true：
 * - boolean true
 * - string: "1" / "true" / "yes" / "on"（大小写不敏感，支持前后空格）
 */
export function isTruthyEnvFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const s = value.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
