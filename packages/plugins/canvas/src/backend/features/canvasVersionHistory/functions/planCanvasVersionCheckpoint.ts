import type { DocumentVersionSummary } from '@app/schemas';
import type { CanvasSnapshot } from '../../../../shared';
import { collectCanvasAssetIds } from '../../canvasDocument';
import type { CanvasVersionHead, CanvasVersionRecord } from '../definitions/canvasVersionHistory';
import { canvasVersionHash, encodeCanvasVersion } from './canvasVersionCodec';
import { canvasVersionId, canvasVersionRecordBytes } from './canvasVersionIdentity';

/** 字段逆增量按实际压缩字节累计，超过同一快照压缩体积才补锚点；迁移边界始终完整。 */
export function planCanvasVersionCheckpoint(input: {
  readonly head: CanvasVersionHead;
  readonly snapshot: CanvasSnapshot;
  readonly budgetBytes: number;
  readonly migration: boolean;
  readonly restoredFrom?: DocumentVersionSummary['restoredFrom'];
}): { readonly record: CanvasVersionRecord; readonly head: CanvasVersionHead } {
  const { head, snapshot } = input;
  const anchor = encodeCanvasVersion(snapshot),
    accumulated = head.bytesSinceAnchor + (head.inverse?.byteLength ?? 0);
  const record: CanvasVersionRecord = {
    versionId: canvasVersionId(head.sequence),
    sequence: head.sequence,
    createdAt: head.changedAt,
    previousVersionId: head.latestVersionId,
    hash: canvasVersionHash(snapshot),
    inverse: head.inverse,
    anchor: input.migration || accumulated >= anchor.byteLength ? anchor : null,
    assetIds: collectCanvasAssetIds(snapshot.elements),
    ...(input.restoredFrom ? { restoredFrom: input.restoredFrom } : {}),
  };
  const usedBytes =
    head.usedBytes + canvasVersionRecordBytes(record) - (head.inverse?.byteLength ?? 0);
  return {
    record,
    head: {
      ...head,
      latestVersionId: record.versionId,
      inverse: null,
      dirtySince: null,
      bytesSinceAnchor: record.anchor ? 0 : accumulated,
      usedBytes,
      overBudgetBytes: Math.max(0, usedBytes - input.budgetBytes),
    },
  };
}
