import type {
  DiagnosticLogInput,
  DiagnosticLogProjectionLimits,
  DiagnosticLogRecord,
} from '../definitions/diagnosticLogContract';

const encoder = new TextEncoder();
const TRUNCATED_MARKER = '...[truncated]';

interface ProjectionBudget {
  nodes: number;
  readonly seen: WeakSet<object>;
  readonly limits: DiagnosticLogProjectionLimits;
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (value.length <= Math.floor(maxBytes / 3)) return value;
  if (value.length <= maxBytes && utf8Bytes(value) <= maxBytes) return value;

  let low = 0;
  let high = Math.min(value.length, maxBytes);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Bytes(value.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }

  // 避免在 UTF-16 代理项中间截断，防止日志里生成替换字符。
  const end = low > 0 && /[\uD800-\uDBFF]/u.test(value.charAt(low - 1)) ? low - 1 : low;
  return value.slice(0, end);
}

function truncateWithMarker(value: string, maxBytes: number): string {
  if (value.length <= maxBytes && utf8Bytes(value) <= maxBytes) return value;
  const markerBytes = utf8Bytes(TRUNCATED_MARKER);
  if (markerBytes >= maxBytes) return truncateUtf8(TRUNCATED_MARKER, maxBytes);
  return `${truncateUtf8(value, maxBytes - markerBytes)}${TRUNCATED_MARKER}`;
}

function singleLine(value: string): string {
  return value.replace(/\r\n|\r|\n/gu, '\\n');
}

function formatLocalDate(date: Date): string {
  const year = `${date.getFullYear()}`.padStart(4, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function projectError(error: Error, depth: number, budget: ProjectionBudget): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    name: truncateWithMarker(error.name, budget.limits.maxStringBytes),
    message: truncateWithMarker(error.message, budget.limits.maxStringBytes),
  };
  if (error.stack) {
    projected.stack = truncateWithMarker(error.stack, budget.limits.maxStringBytes);
  }

  const cause = Reflect.get(error, 'cause');
  if (cause !== undefined) projected.cause = projectValue(cause, depth + 1, budget);

  const commonKeys = ['code', 'errno', 'syscall', 'hostname', 'address', 'port'] as const;
  for (const key of commonKeys) {
    const value = Reflect.get(error, key);
    if (value !== undefined) projected[key] = projectValue(value, depth + 1, budget);
  }
  const reservedKeys = new Set<string>(['name', 'message', 'stack', 'cause', ...commonKeys]);
  const customKeys = Object.getOwnPropertyNames(error)
    .filter(key => !reservedKeys.has(key))
    .slice(0, budget.limits.maxCollectionEntries);
  for (const key of customKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    projected[key] = descriptor && 'value' in descriptor
      ? projectValue(descriptor.value, depth + 1, budget)
      : '[Accessor]';
  }
  return projected;
}

function projectObject(value: object, depth: number, budget: ProjectionBudget): unknown {
  if (budget.seen.has(value)) return '[Circular]';
  budget.seen.add(value);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
  }
  if (value instanceof RegExp) return value.toString();
  if (ArrayBuffer.isView(value)) {
    return { type: value.constructor.name, byteLength: value.byteLength };
  }
  if (value instanceof ArrayBuffer) {
    return { type: 'ArrayBuffer', byteLength: value.byteLength };
  }
  if (depth >= budget.limits.maxDepth) return '[MaxDepth]';
  if (value instanceof Error) return projectError(value, depth, budget);

  if (Array.isArray(value)) {
    const kept = value.slice(0, budget.limits.maxCollectionEntries)
      .map(entry => projectValue(entry, depth + 1, budget));
    if (value.length > kept.length) kept.push(`[${value.length - kept.length} more items]`);
    return kept;
  }

  const keys = Object.keys(value);
  const keptKeys = keys.slice(0, budget.limits.maxCollectionEntries);
  const projected: Record<string, unknown> = {};
  for (const key of keptKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    projected[key] = descriptor && 'value' in descriptor
      ? projectValue(descriptor.value, depth + 1, budget)
      : '[Accessor]';
  }
  if (keys.length > keptKeys.length) projected['[truncatedFields]'] = keys.length - keptKeys.length;
  return projected;
}

function projectValue(value: unknown, depth: number, budget: ProjectionBudget): unknown {
  budget.nodes += 1;
  if (budget.nodes > budget.limits.maxNodes) return '[MaxNodes]';

  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return truncateWithMarker(value, budget.limits.maxStringBytes);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'undefined') return '[Undefined]';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  return projectObject(value, depth, budget);
}

export function projectDiagnosticLogEntry(
  input: DiagnosticLogInput,
  limits: DiagnosticLogProjectionLimits,
): DiagnosticLogRecord {
  const receivedAtIso = input.receivedAt.toISOString();
  const moduleName = truncateWithMarker(singleLine(input.module), 256);
  const message = truncateWithMarker(singleLine(input.message), limits.maxStringBytes);
  const prefix = `[${receivedAtIso}] [${input.level}] [${moduleName}] ${message}`;
  let projectedData = '';
  if (input.data !== undefined) {
    try {
      projectedData = ` ${JSON.stringify(projectValue(input.data, 0, {
          nodes: 0,
          seen: new WeakSet<object>(),
          limits,
        }))}`;
    } catch {
      // 日志 metadata 可能包含会抛错的 Proxy。诊断失败不能反过来改变业务流程。
      projectedData = ' "[ProjectionError]"';
    }
  }

  // 一条逻辑事件必须只占一条物理记录；否则超大 metadata 会绕过文件和队列容量。
  const line = truncateWithMarker(`${prefix}${projectedData}`, limits.maxRecordBytes - 1);
  return {
    receivedAtIso,
    targetDate: formatLocalDate(input.receivedAt),
    level: input.level,
    line,
    utf8Bytes: utf8Bytes(line) + 1,
  };
}
