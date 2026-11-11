import { isRecord } from '@linnya/foundation';
import type { ExportArtifactTargetResult } from '@linnya/plugin-host-contract/renderer/exportArtifact';



function requireString(
  record: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[exportArtifact] invalid target result: ${field}`);
  }
  return value;
}

export function parseExportArtifactTargetResult(
  value: unknown,
): ExportArtifactTargetResult {
  if (!isRecord(value) || (value.status !== 'cancelled' && value.status !== 'authorized')) {
    throw new Error('[exportArtifact] invalid target result');
  }
  if (value.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  if (!isRecord(value.target)) {
    throw new Error('[exportArtifact] invalid authorized target');
  }
  return {
    status: 'authorized',
    target: {
      token: requireString(value.target, 'token'),
      fileName: requireString(value.target, 'fileName'),
    },
  };
}
