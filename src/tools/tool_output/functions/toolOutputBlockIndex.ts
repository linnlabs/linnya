import { createHash } from 'node:crypto';

import {
  TOOL_OUTPUT_INDEX_RECORD_BYTES,
} from '../definitions/toolOutputBlob';

const RECORD_PAYLOAD_BYTES = 48;
const RECORD_CHECKSUM_BYTES = TOOL_OUTPUT_INDEX_RECORD_BYTES - RECORD_PAYLOAD_BYTES;
const MAX_UINT32 = 0xffff_ffff;

export interface ToolOutputBlockIndexRecord {
  readonly newlinesBefore: number;
  readonly charCount: number;
  readonly newlineCount: number;
  readonly bodySha256: string;
}

function assertSafeCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`[ToolOutputStore] ${name} 必须是非负安全整数`);
  }
  return value;
}

function assertUint32(value: number, name: string): number {
  const parsed = assertSafeCount(value, name);
  if (parsed > MAX_UINT32) {
    throw new Error(`[ToolOutputStore] ${name} 超出 block index 范围`);
  }
  return parsed;
}

function writeSafeUint64(buffer: Buffer, value: number, offset: number): void {
  buffer.writeBigUInt64LE(BigInt(assertSafeCount(value, 'newlinesBefore')), offset);
}

function readSafeUint64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('[ToolOutputStore] block index 的换行计数超出安全整数范围');
  }
  return Number(value);
}

function parseSha256(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('[ToolOutputStore] block SHA-256 非法');
  }
  return Buffer.from(value, 'hex');
}

export function encodeToolOutputBlockIndexRecord(
  record: ToolOutputBlockIndexRecord,
): Buffer {
  const buffer = Buffer.alloc(TOOL_OUTPUT_INDEX_RECORD_BYTES);
  writeSafeUint64(buffer, record.newlinesBefore, 0);
  buffer.writeUInt32LE(assertUint32(record.charCount, 'charCount'), 8);
  buffer.writeUInt32LE(assertUint32(record.newlineCount, 'newlineCount'), 12);
  parseSha256(record.bodySha256).copy(buffer, 16);
  createHash('sha256')
    .update(buffer.subarray(0, RECORD_PAYLOAD_BYTES))
    .digest()
    .subarray(0, RECORD_CHECKSUM_BYTES)
    .copy(buffer, RECORD_PAYLOAD_BYTES);
  return buffer;
}

export function decodeToolOutputBlockIndexRecord(
  bytes: Uint8Array,
): ToolOutputBlockIndexRecord {
  if (bytes.byteLength !== TOOL_OUTPUT_INDEX_RECORD_BYTES) {
    throw new Error('[ToolOutputStore] block index record 长度非法');
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedChecksum = createHash('sha256')
    .update(buffer.subarray(0, RECORD_PAYLOAD_BYTES))
    .digest()
    .subarray(0, RECORD_CHECKSUM_BYTES);
  if (!expectedChecksum.equals(buffer.subarray(RECORD_PAYLOAD_BYTES))) {
    throw new Error('[ToolOutputStore] block index record 校验失败');
  }
  return {
    newlinesBefore: readSafeUint64(buffer, 0),
    charCount: buffer.readUInt32LE(8),
    newlineCount: buffer.readUInt32LE(12),
    bodySha256: buffer.subarray(16, 48).toString('hex'),
  };
}
