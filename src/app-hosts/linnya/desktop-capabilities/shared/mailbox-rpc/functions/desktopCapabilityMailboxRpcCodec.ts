import type { JsonValue } from '@app/schemas';

import {
  parseBackendRendererRequestOperationId,
  parseBackendRendererRequestToken,
} from '../../../../adapters/backend-renderer-requests';
import { DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION } from '../definitions/desktopCapabilityMailboxRpc';

export interface DesktopCapabilityMailboxRpcReference {
  readonly protocol_version: typeof DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION;
  readonly operation_id: string;
  readonly token: string;
}

export interface DesktopCapabilityMailboxRpcResult {
  readonly protocol_version: typeof DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION;
  readonly operation_id: string;
}

export function parseDesktopCapabilityMailboxRpcReference(
  value: JsonValue,
): DesktopCapabilityMailboxRpcReference {
  const record = readRecord(value, 'request');
  requireKeys(record, ['protocol_version', 'operation_id', 'token']);
  if (record.protocol_version !== DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION) {
    throw new Error('Desktop capability mailbox protocol_version 不匹配');
  }
  return {
    protocol_version: DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION,
    operation_id: parseBackendRendererRequestOperationId(record.operation_id),
    token: parseBackendRendererRequestToken(record.token),
  };
}

export function parseDesktopCapabilityMailboxRpcResult(
  value: JsonValue,
): DesktopCapabilityMailboxRpcResult {
  const record = readRecord(value, 'response');
  requireKeys(record, ['protocol_version', 'operation_id']);
  if (record.protocol_version !== DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION) {
    throw new Error('Desktop capability mailbox response protocol_version 不匹配');
  }
  return {
    protocol_version: DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION,
    operation_id: parseBackendRendererRequestOperationId(record.operation_id),
  };
}

function readRecord(value: JsonValue, label: string): { [key: string]: JsonValue } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Desktop capability mailbox ${label} 必须是对象`);
  }
  return value;
}

function requireKeys(record: { [key: string]: JsonValue }, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Desktop capability mailbox RPC 字段不合法: ${actual.join(',')}`);
  }
}
