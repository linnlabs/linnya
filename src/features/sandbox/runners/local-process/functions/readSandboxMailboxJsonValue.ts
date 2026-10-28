import type { SandboxJsonValue } from '../../../types.js';
import type { SandboxMailboxJsonReadResult } from '../definitions/sandboxMailboxJsonValue.js';

/** 严格 JSON 准入与复制合并为一次遍历；不同字段仍获得独立的可变副本。 */
export function readSandboxMailboxJsonValue(value: unknown): SandboxMailboxJsonReadResult {
  return readJsonValue(value, new Set());
}

function readJsonValue(value: unknown, ancestors: Set<object>): SandboxMailboxJsonReadResult {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return { valid: true, value };
  if (typeof value === 'number') return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  if (typeof value !== 'object' || ancestors.has(value)) return { valid: false };
  const isArray = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) return { valid: false };
  ancestors.add(value);
  try {
    if (isArray) {
      const result: SandboxJsonValue[] = [];
      for (const item of value) {
        const parsed = readJsonValue(item, ancestors);
        if (!parsed.valid) return parsed;
        result.push(parsed.value);
      }
      return { valid: true, value: result };
    }
    const entries: [string, SandboxJsonValue][] = [];
    for (const [key, item] of Object.entries(value)) {
      const parsed = readJsonValue(item, ancestors);
      if (!parsed.valid) return parsed;
      entries.push([key, parsed.value]);
    }
    return { valid: true, value: Object.fromEntries(entries) };
  } finally {
    ancestors.delete(value);
  }
}
