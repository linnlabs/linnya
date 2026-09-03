import { RuntimeResourceRefs } from '../contracts/resource-ref';

const FORBIDDEN_TRANSIENT_KEYS = new Set([
  'bytes',
  'localPath',
  'local_path',
  'providerFileId',
  'provider_file_id',
  'file_id',
  'rawRequest',
]);

const PROVIDER_IMAGE_PART_TYPES = new Set([
  'image_url',
  'input_image',
  'image',
]);

export class LlmAuditProjectionError extends Error {
  constructor(readonly valuePath: string, message: string) {
    super(`${message} (${valuePath})`);
    this.name = 'LlmAuditProjectionError';
  }
}

/**
 * durable audit 必须保留完整文本和工具协议，但不能接收物化 bytes 或 provider 图片 part。
 * attachments 只能通过 RuntimeResourceRef 严格 schema，借此阻断 resolved attachment 混入。
 */
export function projectDurableLlmAuditValue<T>(value: T): T {
  assertDurableAuditValue(value, '$');
  return structuredClone(value);
}

function assertDurableAuditValue(value: unknown, valuePath: string): void {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new LlmAuditProjectionError(valuePath, 'Binary image payload is not durable audit data');
  }
  if (typeof value === 'string') {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
      throw new LlmAuditProjectionError(valuePath, 'Image data URL is not durable audit data');
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDurableAuditValue(item, `${valuePath}[${index}]`));
    return;
  }

  if (!isRecord(value)) return;
  const record = value;
  if (Object.prototype.hasOwnProperty.call(record, 'attachments')) {
    const parsed = RuntimeResourceRefs.safeParse(record.attachments);
    if (!parsed.success) {
      throw new LlmAuditProjectionError(
        `${valuePath}.attachments`,
        'Audit attachments must use the strict durable resource contract',
      );
    }
  }
  if (typeof record.type === 'string' && PROVIDER_IMAGE_PART_TYPES.has(record.type)) {
    throw new LlmAuditProjectionError(valuePath, 'Provider image part is not durable audit data');
  }
  if (Array.isArray(record.images)) {
    throw new LlmAuditProjectionError(`${valuePath}.images`, 'Provider image array is not durable audit data');
  }
  if (record.type === 'base64' && typeof record.data === 'string') {
    throw new LlmAuditProjectionError(`${valuePath}.data`, 'Provider base64 source is not durable audit data');
  }

  for (const [key, child] of Object.entries(record)) {
    const childPath = `${valuePath}.${key}`;
    if (FORBIDDEN_TRANSIENT_KEYS.has(key)) {
      throw new LlmAuditProjectionError(childPath, 'Transient image field is not durable audit data');
    }
    assertDurableAuditValue(child, childPath);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
