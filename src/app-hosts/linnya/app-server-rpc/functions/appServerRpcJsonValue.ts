import { z } from 'zod';
import type { JsonValue } from '@app/schemas';

/**
 * RPC 的对象由 JSON reader 新建，发出时立即序列化；边界只需校验，无需再次复制整棵树。
 * 按真实类型校验，避免递归 union 为每个对象/数字构造无关分支的错误。
 * 产品 DTO 仍使用各自 schema，不以这个通用 JSON 校验替代业务准入。
 */
export const AppServerRpcJsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(
  value => isRpcJsonValue(value, new Set()),
  { message: 'App Server RPC payload must contain only finite JSON values' },
);

function isRpcJsonValue(value: unknown, ancestors: Set<object>): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    const children: readonly unknown[] = isArray ? value : Object.values(value);
    for (const child of children) if (!isRpcJsonValue(child, ancestors)) return false;
    return true;
  } finally {
    ancestors.delete(value);
  }
}
