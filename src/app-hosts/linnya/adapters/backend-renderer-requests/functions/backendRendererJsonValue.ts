import type { JsonValue } from '@app/schemas';

/** JSON 数据面仍有完整准入；这里只识别可直接传输的值，不丢弃 undefined 或转换类实例。 */
export function isBackendRendererJsonValue(value: unknown): value is JsonValue {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 200_000 || depth > 128) throw new Error('Backend Renderer JSON value 超过容量上限');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object') return false;
    if (ancestors.has(item)) throw new Error('Backend Renderer request value 不接受循环引用');
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return false;
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        for (let index = 0; index < item.length; index++) if (!visit(item[index], depth + 1)) return false;
        return true;
      }
      return Object.values(item).every(child => visit(child, depth + 1));
    } finally { ancestors.delete(item); }
  }
  return visit(value, 0);
}
