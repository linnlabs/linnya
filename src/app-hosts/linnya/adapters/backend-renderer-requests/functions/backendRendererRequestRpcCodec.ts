import type { JsonValue } from '@app/schemas';

import { BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION } from '../definitions/backendRendererRequestRpc';

const OperationIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const TokenPattern = /^[a-f0-9]{32}$/u;

export interface BackendRendererRequestRpcRequest {
  readonly protocol_version: typeof BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION;
  readonly operation_id: string;
  readonly token: string;
  readonly channel: string;
  readonly args: {
    readonly kind: 'inline';
    readonly values: readonly JsonValue[];
  } | {
    readonly kind: 'mailbox';
  };
}

export interface BackendRendererRequestRpcResponse {
  readonly protocol_version: typeof BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION;
  readonly operation_id: string;
  readonly result: {
    readonly kind: 'inline';
    readonly value: JsonValue;
  } | {
    readonly kind: 'mailbox';
  };
}

export function parseBackendRendererRequestOperationId(value: unknown): string {
  if (typeof value !== 'string' || !OperationIdPattern.test(value)) {
    throw new Error('Backend Renderer request operation_id 不合法');
  }
  return value;
}

export function parseBackendRendererRequestToken(value: unknown): string {
  if (typeof value !== 'string' || !TokenPattern.test(value)) {
    throw new Error('Backend Renderer request token 不合法');
  }
  return value;
}

export function parseBackendRendererRequestRpcRequest(
  value: JsonValue,
): BackendRendererRequestRpcRequest {
  const record = readRecord(value, 'request');
  requireKeys(record, ['protocol_version', 'operation_id', 'token', 'channel', 'args']);
  if (record.protocol_version !== BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION) {
    throw new Error('Backend Renderer request protocol_version 不匹配');
  }
  const channel = readNonEmptyString(record.channel, 'channel');
  const args = readRecord(record.args, 'args');
  if (args.kind === 'inline') {
    requireKeys(args, ['kind', 'values']);
    if (!Array.isArray(args.values)) throw new Error('Backend Renderer request inline values 不合法');
    return {
      protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
      operation_id: parseBackendRendererRequestOperationId(record.operation_id),
      token: parseBackendRendererRequestToken(record.token),
      channel,
      args: { kind: 'inline', values: args.values },
    };
  }
  if (args.kind === 'mailbox') {
    requireKeys(args, ['kind']);
    return {
      protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
      operation_id: parseBackendRendererRequestOperationId(record.operation_id),
      token: parseBackendRendererRequestToken(record.token),
      channel,
      args: { kind: 'mailbox' },
    };
  }
  throw new Error('Backend Renderer request args kind 不合法');
}

export function parseBackendRendererRequestRpcResponse(
  value: JsonValue,
): BackendRendererRequestRpcResponse {
  const record = readRecord(value, 'response');
  requireKeys(record, ['protocol_version', 'operation_id', 'result']);
  if (record.protocol_version !== BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION) {
    throw new Error('Backend Renderer response protocol_version 不匹配');
  }
  const operationId = parseBackendRendererRequestOperationId(record.operation_id);
  const result = readRecord(record.result, 'result');
  if (result.kind === 'inline') {
    requireKeys(result, ['kind', 'value']);
    if (result.value === undefined) throw new Error('Backend Renderer inline result 缺少 value');
    return {
      protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
      operation_id: operationId,
      result: { kind: 'inline', value: result.value },
    };
  }
  if (result.kind === 'mailbox') {
    requireKeys(result, ['kind']);
    return {
      protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
      operation_id: operationId,
      result: { kind: 'mailbox' },
    };
  }
  throw new Error('Backend Renderer response result kind 不合法');
}

export function parseBackendRendererRequestChannelList(value: JsonValue): readonly string[] {
  if (!Array.isArray(value)) throw new Error('Backend Renderer request channel list 不合法');
  const channels = value.map((item, index) => readNonEmptyString(item, `channels[${index}]`));
  if (new Set(channels).size !== channels.length) {
    throw new Error('Backend Renderer request channel list 含有重复项');
  }
  return Object.freeze(channels);
}

function readRecord(value: JsonValue | undefined, label: string): { [key: string]: JsonValue } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Backend Renderer ${label} 必须是对象`);
  }
  return value;
}

function readNonEmptyString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Backend Renderer ${label} 必须是非空字符串`);
  }
  return value;
}

function requireKeys(record: { [key: string]: JsonValue }, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Backend Renderer RPC 字段不合法: ${actual.join(',')}`);
  }
}
