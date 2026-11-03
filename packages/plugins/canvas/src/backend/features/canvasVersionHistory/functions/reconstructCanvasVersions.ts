import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import { CanvasSnapshotSchema, type CanvasSnapshot } from '../../../../shared';
import { collectCanvasAssetIds } from '../../canvasDocument';
import type { CanvasVersionHead, CanvasVersionRecord } from '../definitions/canvasVersionHistory';
import { applyCanvasVersionInverse, canvasVersionHash, canvasVersionSnapshot, decodeCanvasVersion, decodeCanvasVersionInverse } from './canvasVersionCodec';

function verified(snapshot: CanvasSnapshot, record: CanvasVersionRecord, documentId: string): CanvasSnapshot {
  const result = canvasVersionSnapshot(snapshot);
  if (result.documentId !== documentId || result.sequence !== record.sequence || canvasVersionHash(result) !== record.hash || JSON.stringify([...collectCanvasAssetIds(result.elements)].sort()) !== JSON.stringify([...record.assetIds].sort())) throw new DocumentHistoryError('version_corrupt');
  return result;
}
/** 锚点可独立读取；没有锚点时沿实际 previous 身份反放，不猜 sequence-1。 */
export function reconstructCanvasVersion(input: { readonly documentId: string; readonly versionId: string; readonly records: readonly CanvasVersionRecord[]; readonly head: CanvasVersionHead; readonly readCurrent: () => CanvasSnapshot }): CanvasSnapshot {
  const target = input.records.find(record => record.versionId === input.versionId);
  if (!target) throw new DocumentHistoryError('version_not_found');
  const available = input.records.filter(record => record.sequence >= target.sequence);
  const anchor = [...available].reverse().find(record => record.anchor);
  let record: CanvasVersionRecord | undefined = anchor ?? input.records.find(row => row.versionId === input.head.latestVersionId);
  if (!record) throw new DocumentHistoryError('version_corrupt');
  let snapshot = anchor?.anchor ? CanvasSnapshotSchema.parse(decodeCanvasVersion(anchor.anchor)) : applyCanvasVersionInverse(input.readCurrent(), decodeCanvasVersionInverse(input.head.inverse), record.sequence);
  snapshot = verified(snapshot, record, input.documentId);
  while (record.versionId !== target.versionId) {
    const older = input.records.find(row => row.versionId === record?.previousVersionId);
    if (!older || older.sequence >= record.sequence) throw new DocumentHistoryError('version_corrupt');
    snapshot = verified(applyCanvasVersionInverse(snapshot, decodeCanvasVersionInverse(record.inverse), older.sequence), older, input.documentId);
    record = older;
  }
  return snapshot;
}

/** 维护单次反放并校验全部版本及锚点，包括准备删除的记录，不能用锚点跳过坏增量。 */
export function reconstructAllCanvasVersions(input: { readonly documentId: string; readonly records: readonly CanvasVersionRecord[]; readonly head: CanvasVersionHead; readonly current: CanvasSnapshot }): ReadonlyMap<string, CanvasSnapshot> {
  const snapshots = new Map<string, CanvasSnapshot>(); const latest = input.records[0];
  if (!latest || latest.versionId !== input.head.latestVersionId || input.current.sequence !== input.head.sequence) throw new DocumentHistoryError('version_corrupt');
  let snapshot = applyCanvasVersionInverse(input.current, decodeCanvasVersionInverse(input.head.inverse), latest.sequence);
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index];
    snapshot = verified(snapshot, record, input.documentId); snapshots.set(record.versionId, snapshot);
    if (record.anchor) verified(CanvasSnapshotSchema.parse(decodeCanvasVersion(record.anchor)), record, input.documentId);
    const older = input.records[index + 1];
    if (record.previousVersionId !== (older?.versionId ?? null) || (older && older.sequence >= record.sequence)) throw new DocumentHistoryError('version_corrupt');
    if (older) snapshot = applyCanvasVersionInverse(snapshot, decodeCanvasVersionInverse(record.inverse), older.sequence);
    else if (!record.anchor || record.inverse) throw new DocumentHistoryError('version_corrupt');
  }
  return snapshots;
}
