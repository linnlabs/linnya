import type { JsonValue } from '@app/schemas';

const MAX_VALUE_DEPTH = 128;
const MAX_VALUE_NODES = 200_000;

interface EncodingBudget {
  nodes: number;
}

function consumeNode(budget: EncodingBudget, depth: number): void {
  if (depth > MAX_VALUE_DEPTH) {
    throw new Error(`Backend Renderer request value 超过最大深度 ${MAX_VALUE_DEPTH}`);
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_VALUE_NODES) {
    throw new Error(`Backend Renderer request value 超过最大节点数 ${MAX_VALUE_NODES}`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Electron structured clone 中的现有参数先进入显式 tagged value，再进入 JSON RPC。
 * tag 包住每个节点，用户对象即使含有 `kind` 字段也不会与协议元数据冲突。
 */
export function encodeBackendRendererRequestValue(value: unknown): JsonValue {
  return encodeValue(value, 0, { nodes: 0 }, new Set<object>());
}

function encodeValue(
  value: unknown,
  depth: number,
  budget: EncodingBudget,
  ancestors: Set<object>,
): JsonValue {
  consumeNode(budget, depth);
  if (value === null) return { kind: 'null' };
  if (value === undefined) return { kind: 'undefined' };
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Backend Renderer request value 不接受非有限 number');
    }
    return { kind: 'number', value };
  }
  if (typeof value === 'bigint') {
    return { kind: 'bigint', value: value.toString(10) };
  }
  if (value instanceof Uint8Array) {
    return { kind: 'bytes', value: Buffer.from(value).toString('base64') };
  }
  if (value instanceof ArrayBuffer) {
    return { kind: 'bytes', value: Buffer.from(value).toString('base64') };
  }
  if (typeof value !== 'object') {
    throw new Error(`Backend Renderer request value 不接受 ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new Error('Backend Renderer request value 不接受循环引用');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return {
        kind: 'array',
        value: value.map(item => encodeValue(item, depth + 1, budget, ancestors)),
      };
    }
    if (!isPlainRecord(value)) {
      throw new Error('Backend Renderer request value 只接受普通对象、数组与二进制');
    }
    return {
      kind: 'object',
      value: Object.entries(value).map(([key, item]) => ([
        key,
        encodeValue(item, depth + 1, budget, ancestors),
      ])),
    };
  } finally {
    ancestors.delete(value);
  }
}

export function decodeBackendRendererRequestValue(value: JsonValue): unknown {
  return decodeValue(value, 0, { nodes: 0 });
}

function decodeValue(value: JsonValue, depth: number, budget: EncodingBudget): unknown {
  consumeNode(budget, depth);
  if (!isJsonRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Backend Renderer request wire value 缺少合法 kind');
  }
  switch (value.kind) {
    case 'null':
      requireExactKeys(value, ['kind']);
      return null;
    case 'undefined':
      requireExactKeys(value, ['kind']);
      return undefined;
    case 'string':
      requireExactKeys(value, ['kind', 'value']);
      if (typeof value.value !== 'string') throw invalidWireValue('string');
      return value.value;
    case 'boolean':
      requireExactKeys(value, ['kind', 'value']);
      if (typeof value.value !== 'boolean') throw invalidWireValue('boolean');
      return value.value;
    case 'number':
      requireExactKeys(value, ['kind', 'value']);
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        throw invalidWireValue('number');
      }
      return value.value;
    case 'bigint':
      requireExactKeys(value, ['kind', 'value']);
      if (typeof value.value !== 'string' || !/^-?(?:0|[1-9]\d*)$/u.test(value.value)) {
        throw invalidWireValue('bigint');
      }
      return BigInt(value.value);
    case 'bytes':
      requireExactKeys(value, ['kind', 'value']);
      if (typeof value.value !== 'string' || !isCanonicalBase64(value.value)) {
        throw invalidWireValue('bytes');
      }
      return Uint8Array.from(Buffer.from(value.value, 'base64'));
    case 'array':
      requireExactKeys(value, ['kind', 'value']);
      if (!Array.isArray(value.value)) throw invalidWireValue('array');
      return value.value.map(item => decodeValue(item, depth + 1, budget));
    case 'object': {
      requireExactKeys(value, ['kind', 'value']);
      if (!Array.isArray(value.value)) throw invalidWireValue('object');
      const result: Record<string, unknown> = {};
      for (const entry of value.value) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
          throw invalidWireValue('object');
        }
        if (Object.prototype.hasOwnProperty.call(result, entry[0])) {
          throw new Error('Backend Renderer request wire object 含有重复 key');
        }
        result[entry[0]] = decodeValue(entry[1], depth + 1, budget);
      }
      return result;
    }
    default:
      throw new Error(`Backend Renderer request wire value kind 未登记: ${value.kind}`);
  }
}

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExactKeys(value: { [key: string]: JsonValue }, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`Backend Renderer request wire value 字段不合法: ${actual.join(',')}`);
  }
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0) return true;
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function invalidWireValue(kind: string): Error {
  return new Error(`Backend Renderer request wire ${kind} value 不合法`);
}
