import { createHash } from 'node:crypto';

import { parseToolOutputBlobId, type ToolOutputBlobId } from '@app/schemas';
import type { ToolOutputBlobManifest } from '../definitions/toolOutputBlob';

type JsonRecord = Readonly<Record<string, unknown>>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isJsonRecord(value)) {
    const fields = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

/** blob ID 覆盖严格 manifest；正文与索引的完整 hash 已经包含在 manifest 中。 */
export function computeToolOutputBlobId(manifest: ToolOutputBlobManifest): ToolOutputBlobId {
  const digest = createHash('sha256')
    .update(stableStringify(manifest), 'utf8')
    .digest('hex')
    .slice(0, 16);
  return parseToolOutputBlobId(digest);
}
