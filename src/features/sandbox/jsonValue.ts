import type { SandboxJsonValue } from './types.js';
import { isSandboxJsonValue } from './types.js';

export function toTransportJsonValue(value: unknown): SandboxJsonValue | undefined {
  if (value === undefined) return undefined;

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('值不可序列化：JSON.stringify 返回 undefined。');
  }

  const parsed: unknown = JSON.parse(serialized);
  if (!isSandboxJsonValue(parsed)) {
    throw new Error('值不可序列化：结果不是合法 JSON 值。');
  }
  return parsed;
}

export function measureJsonBytes(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
