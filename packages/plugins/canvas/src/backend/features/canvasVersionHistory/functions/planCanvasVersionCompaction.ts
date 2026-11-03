import { DocumentHistoryError, planDocumentVersionRetention } from '@plugin/backend/documentHistory';
import { DocumentVersionListSchema, type DocumentAssetByteFact, type DocumentVersionSummary } from '@app/schemas';
import type { CanvasSnapshot } from '../../../../shared';
import type { CanvasVersionRecord } from '../definitions/canvasVersionHistory';
import { canvasVersionRecordBytes } from './canvasVersionIdentity';
import { composeCanvasVersionInverse, decodeCanvasVersionInverse, encodeCanvasVersion } from './canvasVersionCodec';

function rechain(records: readonly CanvasVersionRecord[], snapshots: ReadonlyMap<string, CanvasSnapshot>, keep: ReadonlySet<string>): CanvasVersionRecord[] {
  if (records.every(record => keep.has(record.versionId))) return [...records];
  const result: CanvasVersionRecord[] = []; let pending: CanvasVersionRecord | undefined; let combined = decodeCanvasVersionInverse(null);
  for (const record of records) {
    if (keep.has(record.versionId)) {
      if (pending) result.push({ ...pending, previousVersionId: record.versionId, inverse: combined.length ? encodeCanvasVersion(combined) : null });
      pending = record; combined = decodeCanvasVersionInverse(record.inverse);
    } else if (pending) combined = composeCanvasVersionInverse(combined, decodeCanvasVersionInverse(record.inverse));
  }
  if (pending) {
    const oldest = snapshots.get(pending.versionId); if (!oldest) throw new DocumentHistoryError('version_corrupt');
    result.push({ ...pending, previousVersionId: null, inverse: null, anchor: encodeCanvasVersion(oldest) });
  }
  return result;
}
/** 共享图分配给最新仍保留的持有版本；从旧删时只有最后的持有者退出才减少字节。 */
function bytePlan(input: { readonly rows: readonly DocumentVersionSummary[]; readonly records: readonly CanvasVersionRecord[]; readonly headBytes: number; readonly facts: readonly DocumentAssetByteFact[]; readonly protectedAssets: ReadonlySet<string> }) {
  const { rows, records, headBytes, facts, protectedAssets } = input;
  const byVersion = new Map(records.map(record => [record.versionId, canvasVersionRecordBytes(record)]));
  const factsById = new Map(facts.map(fact => [fact.assetId, fact.byteLength])); const counted = new Set<string>();
  for (const record of records) for (const asset of record.assetIds) {
    if (protectedAssets.has(asset) || counted.has(asset)) continue;
    const bytes = factsById.get(asset); if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Canvas history asset byte fact is missing or invalid.');
    const payloadBytes = byVersion.get(record.versionId); if (payloadBytes === undefined) throw new DocumentHistoryError('version_corrupt');
    counted.add(asset); byVersion.set(record.versionId, payloadBytes + bytes);
  }
  const current = rows[0]; if (current) byVersion.set(current.versionId, (byVersion.get(current.versionId) ?? 0) + headBytes);
  return rows.map(row => { const byteLength = byVersion.get(row.versionId); if (byteLength === undefined) throw new DocumentHistoryError('version_corrupt'); return { versionId: row.versionId, byteLength }; });
}
export function planCanvasVersionCompaction(input: { readonly rows: readonly DocumentVersionSummary[]; readonly records: readonly CanvasVersionRecord[]; readonly snapshots: ReadonlyMap<string, CanvasSnapshot>; readonly headBytes: number; readonly budgetBytes: number; readonly assetFacts: readonly DocumentAssetByteFact[]; readonly protectedAssetIds: readonly string[] }) {
  const rows = DocumentVersionListSchema.parse(input.rows); const protectedAssets = new Set(input.protectedAssetIds);
  const base = planDocumentVersionRetention(rows);
  let keep = new Set(base.keepVersionIds), records = rechain(input.records, input.snapshots, keep);
  for (;;) {
    const candidates = rows.filter(row => keep.has(row.versionId));
    const versionBytes = bytePlan({ rows: candidates, records, headBytes: input.headBytes, facts: input.assetFacts, protectedAssets });
    const plan = planDocumentVersionRetention(candidates, { budgetBytes: input.budgetBytes, versionBytes });
    if (plan.keepVersionIds.length === candidates.length) {
      const usedBytes = versionBytes.reduce((total, row) => total + row.byteLength, 0);
      return { records, keepVersionIds: plan.keepVersionIds, usedBytes, overBudgetBytes: Math.max(0, usedBytes - input.budgetBytes) };
    }
    keep = new Set(plan.keepVersionIds); records = rechain(input.records, input.snapshots, keep);
  }
}
