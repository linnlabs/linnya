import type { DocumentVersionSummary } from '@app/schemas';
import type { CanvasVersionRecord } from '../definitions/canvasVersionHistory';
export function canvasVersionId(sequence: number): string {
  return `canvas-version:${sequence}`;
}
export function summarizeCanvasVersion(
  record: Pick<CanvasVersionRecord, 'versionId' | 'sequence' | 'createdAt' | 'restoredFrom'>,
  isCurrent: boolean
): DocumentVersionSummary {
  return {
    versionId: record.versionId,
    order: record.sequence + 1,
    createdAt: record.createdAt,
    isCurrent,
    ...(record.restoredFrom ? { restoredFrom: record.restoredFrom } : {}),
  };
}
export function canvasVersionRecordBytes(record: CanvasVersionRecord): number {
  return (
    (record.inverse?.byteLength ?? 0) +
    (record.anchor?.byteLength ?? 0) +
    Buffer.byteLength(JSON.stringify({ ...record, inverse: null, anchor: null }))
  );
}
