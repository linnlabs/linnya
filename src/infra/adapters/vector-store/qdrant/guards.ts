/**
 * @file src/infra/adapters/vector-store/qdrant/guards.ts
 *
 * @brief Qdrant 适配器内部使用的类型守卫与安全取值函数
 *
 * @description
 * 目标：在不使用 any / 不使用不安全断言的前提下，把 unknown 收敛成可用的结构。
 */

import type { QdrantScrollOffset, SparseVector } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function isSparseVector(value: unknown): value is SparseVector {
  if (!isRecord(value)) return false;
  return isNumberArray(value['indices']) && isNumberArray(value['values']);
}

export function isQdrantScrollOffset(value: unknown): value is QdrantScrollOffset {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (isRecord(value)) return true;
  return false;
}

export function getNumberProp(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function getStringProp(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

export function hasNameAndVector(value: unknown): value is { name: string; vector: unknown } {
  return isRecord(value) && typeof value['name'] === 'string' && 'vector' in value;
}


