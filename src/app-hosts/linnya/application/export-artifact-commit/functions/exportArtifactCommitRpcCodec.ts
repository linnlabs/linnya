import type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
} from '@linnya/plugin-host-contract/backend/exportArtifact';

export function parseExportArtifactCommitMailboxArgs(
  args: readonly unknown[],
): ExportArtifactCommitRequest {
  if (args.length !== 1) throw new Error('Export artifact commit mailbox 必须含一个参数');
  const request = readRecord(args[0], 'request');
  requireExactKeys(request, [
    'pluginId',
    'targetToken',
    'extension',
    'mediaType',
    'bytes',
  ]);
  return {
    pluginId: readNonEmptyString(request.pluginId, 'pluginId'),
    targetToken: readNonEmptyString(request.targetToken, 'targetToken'),
    extension: readNonEmptyString(request.extension, 'extension'),
    mediaType: readNonEmptyString(request.mediaType, 'mediaType'),
    bytes: readNonEmptyBytes(request.bytes),
  };
}

export function parseExportArtifactCommitMailboxResult(
  value: unknown,
): ExportArtifactCommitResult {
  const result = readRecord(value, 'result');
  requireExactKeys(result, ['fileName', 'byteLength']);
  if (typeof result.byteLength !== 'number'
    || !Number.isSafeInteger(result.byteLength)
    || result.byteLength <= 0) {
    throw new Error('Export artifact commit byteLength 不合法');
  }
  return {
    fileName: readNonEmptyString(result.fileName, 'fileName'),
    byteLength: result.byteLength,
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Export artifact commit ${label} 必须是对象`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`Export artifact commit 字段不合法: ${actual.join(',')}`);
  }
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Export artifact commit ${label} 必须是非空字符串`);
  }
  return value;
}

function readNonEmptyBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error('Export artifact commit bytes 必须是非空 Uint8Array');
  }
  return value;
}
