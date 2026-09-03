import type {
  SandboxJsonObject,
  SandboxJsonValue,
} from '@plugin/backend/sandboxRuntime';

export function measureJsonBytes(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function isSandboxJsonObject(value: unknown): value is SandboxJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!hasPlainObjectPrototype(value)) return false;
  try {
    return isSandboxJsonContainer(value, new WeakSet<object>());
  } catch {
    return false;
  }
}

/**
 * 将内部领域对象投影为真正可跨线程传输的 JSON DTO。
 *
 * 领域对象允许可选字段以 `undefined` 表示未设置；Worker 协议不允许这种
 * JavaScript 专属值，因此在生产者出口统一按 JSON 语义移除，而不是放宽协议。
 */
export function projectSandboxJsonObject(value: unknown): SandboxJsonObject {
  if (!isJsonObjectProjectable(value, new WeakSet<object>())) {
    throw new Error('Slides build payload contains a value that JSON cannot represent.');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Slides build payload cannot be serialized as JSON.');
  }
  if (serialized === undefined) {
    throw new Error('Slides build payload cannot be serialized as a JSON object.');
  }

  const projected: unknown = JSON.parse(serialized);
  if (!isSandboxJsonObject(projected)) {
    throw new Error('Slides build payload must be a finite JSON object.');
  }
  return projected;
}

function isJsonObjectProjectable(value: unknown, visited: WeakSet<object>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return isJsonContainerProjectable(value, visited);
}

function isJsonContainerProjectable(
  value: object,
  ancestors: WeakSet<object>,
): boolean {
  if (ancestors.has(value)) return false;
  ancestors.add(value);

  const projectable = Array.isArray(value)
    ? value.every(entry => (
      entry !== undefined && isJsonValueProjectable(entry, ancestors)
    ))
    : hasPlainObjectPrototype(value) && Object.values(value).every(entry => (
      entry === undefined
        ? true
        : isJsonValueProjectable(entry, ancestors)
    ));
  ancestors.delete(value);
  return projectable;
}

function isJsonValueProjectable(
  value: unknown,
  ancestors: WeakSet<object>,
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (!value || typeof value !== 'object') return false;
  return isJsonContainerProjectable(value, ancestors);
}

function isSandboxJsonContainer(value: object, ancestors: WeakSet<object>): boolean {
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every(entry => isSandboxJsonValue(entry, ancestors))
    : hasPlainObjectPrototype(value)
      && Object.values(value).every(entry => isSandboxJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isSandboxJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (!value || typeof value !== 'object') return false;
  return isSandboxJsonContainer(value, ancestors);
}

function hasPlainObjectPrototype(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
