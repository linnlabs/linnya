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

/** 裁剪先验证链的元数据；载荷只在真正合并逆增量或生成新锚点时接纳。 */
export function validateCanvasVersionChain(records: readonly CanvasVersionRecord[], head: CanvasVersionHead): void {
  const latest = records[0];
  if (!latest || latest.versionId !== head.latestVersionId || latest.sequence > head.sequence) throw new DocumentHistoryError('version_corrupt');
  for (let index = 0; index < records.length; index++) {
    const record = records[index], older = records[index + 1];
    if (record.previousVersionId !== (older?.versionId ?? null) || (older && older.sequence >= record.sequence)) throw new DocumentHistoryError('version_corrupt');
    if (!older && (!record.anchor || record.inverse)) throw new DocumentHistoryError('version_corrupt');
  }
}
