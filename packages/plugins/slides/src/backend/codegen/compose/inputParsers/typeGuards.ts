/**
 * 通用类型守卫与基础解析工具。
 * 所有 tool input 解析器的最底层依赖，不依赖任何同级模块。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** 将字符串、数字、布尔值统一转为展示用字符串 */
export function parseDisplayString(value: unknown): string | null {
  if (isNonEmptyString(value)) {
    return value.trim();
  }
  if (isFiniteNumber(value) || isBoolean(value)) {
    return String(value);
  }
  return null;
}

export function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    return null;
  }
  return value;
}

export function parseLabelArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const labels: string[] = [];
  for (const entry of value) {
    const normalized = parseDisplayString(entry);
    if (!normalized) {
      return null;
    }
    labels.push(normalized);
  }
  return labels;
}

export function parseStringMatrix(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null;
  const rows: string[][] = [];
  for (const row of value) {
    const parsedRow = parseStringArray(row);
    if (!parsedRow) return null;
    rows.push(parsedRow);
  }
  return rows;
}
