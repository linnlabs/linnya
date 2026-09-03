import { open, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import type { JsonValue } from '@app/schemas';

import {
  BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES,
  BACKEND_RENDERER_REQUEST_MAILBOX_CONTENT_MAX_BYTES,
  BACKEND_RENDERER_REQUEST_MAILBOX_METADATA_MAX_BYTES,
  BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
} from '../definitions/backendRendererRequestRpc';
import {
  parseBackendRendererRequestOperationId,
  parseBackendRendererRequestToken,
} from './backendRendererRequestRpcCodec';
import {
  decodeBackendRendererRequestValue,
  encodeBackendRendererRequestValue,
} from './backendRendererRequestValueCodec';

const REQUEST_METADATA_FILE = 'request.json';
const RESPONSE_METADATA_FILE = 'response.json';
const MAX_EXTERNAL_FILES = 1024;

interface ExternalFileBudget {
  bytes: number;
  files: number;
}

interface MailboxContext {
  readonly directory: string;
  readonly prefix: 'request' | 'response';
  readonly budget: ExternalFileBudget;
}

export function resolveBackendRendererRequestMailboxRoot(appDataRoot: string): string {
  if (!path.isAbsolute(appDataRoot)) {
    throw new Error('Backend Renderer mailbox appDataRoot 必须是绝对路径');
  }
  return path.join(appDataRoot, 'app-server-renderer-requests');
}

export async function prepareBackendRendererRequestMailboxRoot(root: string): Promise<void> {
  if (!path.isAbsolute(root)) throw new Error('Backend Renderer mailbox root 必须是绝对路径');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error('Backend Renderer mailbox root 不是目录');
}

export async function cleanupBackendRendererRequestMailbox(input: {
  readonly root: string;
  readonly operationId: string;
}): Promise<void> {
  const directory = resolveOperationDirectory(input.root, input.operationId);
  await rm(directory, { recursive: true, force: true });
}

export function shouldUseBackendRendererRequestMailbox(values: readonly unknown[]): boolean {
  const seen = new Set<object>();
  return values.some(value => containsLargeLeaf(value, seen));
}

function containsLargeLeaf(value: unknown, ancestors: Set<object>): boolean {
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8') >= BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES;
  }
  if (value instanceof Uint8Array) {
    return value.byteLength >= BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength >= BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES;
  }
  if (typeof value !== 'object' || value === null) return false;
  if (ancestors.has(value)) throw new Error('Backend Renderer request value 不接受循环引用');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.some(item => containsLargeLeaf(item, ancestors));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value).some(item => containsLargeLeaf(item, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

export async function publishBackendRendererRequestMailbox(input: {
  readonly root: string;
  readonly operationId: string;
  readonly token: string;
  readonly channel: string;
  readonly args: readonly unknown[];
}): Promise<void> {
  const operationId = parseBackendRendererRequestOperationId(input.operationId);
  const token = parseBackendRendererRequestToken(input.token);
  const directory = await prepareOperationDirectory(input.root, operationId);
  const context: MailboxContext = {
    directory,
    prefix: 'request',
    budget: { bytes: 0, files: 0 },
  };
  const args: JsonValue[] = [];
  for (const value of input.args) args.push(await encodeMailboxValue(value, context));
  await publishMetadata(path.join(directory, REQUEST_METADATA_FILE), {
    protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
    kind: 'backend_renderer_request',
    token,
    channel: input.channel,
    args,
  });
}

export async function readBackendRendererRequestMailbox(input: {
  readonly root: string;
  readonly operationId: string;
  readonly token: string;
  readonly expectedChannel: string;
}): Promise<readonly unknown[]> {
  const directory = resolveOperationDirectory(input.root, input.operationId);
  const metadata = readRecord(
    await readMetadata(path.join(directory, REQUEST_METADATA_FILE)),
    'request metadata',
  );
  requireMetadata(metadata, 'backend_renderer_request', input.token);
  if (metadata.channel !== input.expectedChannel) {
    throw new Error('Backend Renderer mailbox channel 不匹配');
  }
  if (!Array.isArray(metadata.args)) throw new Error('Backend Renderer mailbox args 不合法');
  const values: unknown[] = [];
  for (const value of metadata.args) {
    values.push(await decodeMailboxValue(value, directory, 'request'));
  }
  return values;
}

export async function publishBackendRendererResponseMailbox(input: {
  readonly root: string;
  readonly operationId: string;
  readonly token: string;
  readonly result: unknown;
}): Promise<void> {
  const operationId = parseBackendRendererRequestOperationId(input.operationId);
  const token = parseBackendRendererRequestToken(input.token);
  const directory = await prepareOperationDirectory(input.root, operationId);
  const result = await encodeMailboxValue(input.result, {
    directory,
    prefix: 'response',
    budget: { bytes: 0, files: 0 },
  });
  await publishMetadata(path.join(directory, RESPONSE_METADATA_FILE), {
    protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
    kind: 'backend_renderer_response',
    token,
    result,
  });
}

export async function readBackendRendererResponseMailbox(input: {
  readonly root: string;
  readonly operationId: string;
  readonly token: string;
}): Promise<unknown> {
  const directory = resolveOperationDirectory(input.root, input.operationId);
  const metadata = readRecord(
    await readMetadata(path.join(directory, RESPONSE_METADATA_FILE)),
    'response metadata',
  );
  requireMetadata(metadata, 'backend_renderer_response', input.token);
  if (metadata.result === undefined) throw new Error('Backend Renderer mailbox result 缺失');
  return decodeMailboxValue(metadata.result, directory, 'response');
}

async function encodeMailboxValue(value: unknown, context: MailboxContext): Promise<JsonValue> {
  if (typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES) {
    const bytes = Buffer.byteLength(value, 'utf8');
    const fileName = await publishExternalFile(context, 'txt', value, bytes);
    return { kind: 'external_string', file_name: fileName, byte_length: bytes };
  }
  if (value instanceof Uint8Array
    && value.byteLength >= BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES) {
    const fileName = await publishExternalFile(context, 'bin', value, value.byteLength);
    return { kind: 'external_bytes', file_name: fileName, byte_length: value.byteLength };
  }
  if (value instanceof ArrayBuffer
    && value.byteLength >= BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES) {
    const bytes = new Uint8Array(value);
    const fileName = await publishExternalFile(context, 'bin', bytes, bytes.byteLength);
    return { kind: 'external_bytes', file_name: fileName, byte_length: bytes.byteLength };
  }
  if (Array.isArray(value)) {
    const encoded: JsonValue[] = [];
    for (const item of value) encoded.push(await encodeMailboxValue(item, context));
    return { kind: 'array', value: encoded };
  }
  if (isPlainRecord(value)) {
    const entries: JsonValue[] = [];
    for (const [key, item] of Object.entries(value)) {
      entries.push([key, await encodeMailboxValue(item, context)]);
    }
    return { kind: 'object', value: entries };
  }
  return encodeBackendRendererRequestValue(value);
}

async function decodeMailboxValue(
  value: JsonValue,
  directory: string,
  expectedPrefix: 'request' | 'response',
): Promise<unknown> {
  if (!isJsonRecord(value) || typeof value.kind !== 'string') {
    return decodeBackendRendererRequestValue(value);
  }
  if (value.kind === 'external_string' || value.kind === 'external_bytes') {
    const expectedKeys = ['kind', 'file_name', 'byte_length'];
    requireExactKeys(value, expectedKeys);
    if (typeof value.file_name !== 'string'
      || !new RegExp(`^${expectedPrefix}-[0-9]{4}\\.(?:txt|bin)$`, 'u').test(value.file_name)
      || typeof value.byte_length !== 'number'
      || !Number.isSafeInteger(value.byte_length)
      || value.byte_length < 0
      || value.byte_length > BACKEND_RENDERER_REQUEST_MAILBOX_CONTENT_MAX_BYTES) {
      throw new Error('Backend Renderer external mailbox value 不合法');
    }
    const bytes = await readExternalFile(
      path.join(directory, value.file_name),
      value.byte_length,
    );
    if (value.kind === 'external_bytes') return Uint8Array.from(bytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('Backend Renderer external string 不是合法 UTF-8');
    }
  }
  if (value.kind === 'array') {
    requireExactKeys(value, ['kind', 'value']);
    if (!Array.isArray(value.value)) throw new Error('Backend Renderer mailbox array 不合法');
    const output: unknown[] = [];
    for (const item of value.value) output.push(await decodeMailboxValue(item, directory, expectedPrefix));
    return output;
  }
  if (value.kind === 'object') {
    requireExactKeys(value, ['kind', 'value']);
    if (!Array.isArray(value.value)) throw new Error('Backend Renderer mailbox object 不合法');
    const output: Record<string, unknown> = {};
    for (const entry of value.value) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
        throw new Error('Backend Renderer mailbox object entry 不合法');
      }
      if (Object.prototype.hasOwnProperty.call(output, entry[0])) {
        throw new Error('Backend Renderer mailbox object 含有重复 key');
      }
      output[entry[0]] = await decodeMailboxValue(entry[1], directory, expectedPrefix);
    }
    return output;
  }
  return decodeBackendRendererRequestValue(value);
}

async function publishExternalFile(
  context: MailboxContext,
  extension: 'txt' | 'bin',
  data: string | Uint8Array,
  byteLength: number,
): Promise<string> {
  context.budget.files += 1;
  context.budget.bytes += byteLength;
  if (context.budget.files > MAX_EXTERNAL_FILES
    || context.budget.bytes > BACKEND_RENDERER_REQUEST_MAILBOX_CONTENT_MAX_BYTES) {
    throw new Error('Backend Renderer mailbox 外部内容超过容量上限');
  }
  const fileName = `${context.prefix}-${String(context.budget.files).padStart(4, '0')}.${extension}`;
  const handle = await open(path.join(context.directory, fileName), 'wx', 0o600);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  return fileName;
}

async function readExternalFile(filePath: string, expectedBytes: number): Promise<Buffer> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size !== expectedBytes) {
    throw new Error('Backend Renderer external mailbox file 大小或类型不匹配');
  }
  return readFile(filePath);
}

async function prepareOperationDirectory(root: string, operationId: string): Promise<string> {
  await prepareBackendRendererRequestMailboxRoot(root);
  const directory = resolveOperationDirectory(root, operationId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) throw new Error('Backend Renderer operation mailbox 不是目录');
  return directory;
}

function resolveOperationDirectory(root: string, operationId: string): string {
  if (!path.isAbsolute(root)) throw new Error('Backend Renderer mailbox root 必须是绝对路径');
  return path.join(root, parseBackendRendererRequestOperationId(operationId));
}

async function publishMetadata(filePath: string, value: JsonValue): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.byteLength > BACKEND_RENDERER_REQUEST_MAILBOX_METADATA_MAX_BYTES) {
    throw new Error('Backend Renderer mailbox metadata 超过容量上限');
  }
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

async function readMetadata(filePath: string): Promise<JsonValue> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size > BACKEND_RENDERER_REQUEST_MAILBOX_METADATA_MAX_BYTES) {
    throw new Error('Backend Renderer mailbox metadata 大小或类型不合法');
  }
  const bytes = await readFile(filePath);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Backend Renderer mailbox metadata 不是合法 UTF-8');
  }
  const parsed: unknown = JSON.parse(text);
  if (!isJsonValue(parsed)) throw new Error('Backend Renderer mailbox metadata 不是 JSON value');
  return parsed;
}

function requireMetadata(
  metadata: { [key: string]: JsonValue },
  kind: 'backend_renderer_request' | 'backend_renderer_response',
  token: string,
): void {
  parseBackendRendererRequestToken(token);
  if (metadata.protocol_version !== BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION
    || metadata.kind !== kind
    || metadata.token !== token) {
    throw new Error('Backend Renderer mailbox metadata identity 不匹配');
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: JsonValue, label: string): { [key: string]: JsonValue } {
  if (!isJsonRecord(value)) throw new Error(`Backend Renderer ${label} 必须是对象`);
  return value;
}

function requireExactKeys(record: { [key: string]: JsonValue }, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error('Backend Renderer mailbox value 字段不合法');
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isJsonValue);
}
