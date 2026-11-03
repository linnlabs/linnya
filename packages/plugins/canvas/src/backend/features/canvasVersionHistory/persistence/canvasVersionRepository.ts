import { canvasVersionId, summarizeCanvasVersion } from '../functions/canvasVersionIdentity';
import { z } from 'zod';
import { DocumentVersionSummarySchema, type DocumentVersionSummary } from '@app/schemas';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type { CanvasVersionHead, CanvasVersionRecord } from '../definitions/canvasVersionHistory';
const bytes = z.instanceof(Uint8Array).nullable();
const recordSchema = z.object({ version_id: z.string(), sequence: z.number().int().nonnegative(), created_at: z.number().int().nonnegative(), schema_version: z.literal(1), previous_version_id: z.string().nullable(), state_hash: z.string(), reverse_blob: bytes, anchor_blob: bytes, asset_ids_json: z.string(), restored_from_json: z.string().nullable() });
const headSchema = z.object({ latest_version_id: z.string(), head_sequence: z.number().int().nonnegative(), changed_at: z.number().int().nonnegative(), dirty_since: z.number().nullable(), reverse_blob: bytes, bytes_since_anchor: z.number(), used_bytes: z.number(), over_budget_bytes: z.number() });
function parseRecord(value: unknown): CanvasVersionRecord {
  try {
    const row = recordSchema.parse(value);
    return { versionId: row.version_id, sequence: row.sequence, createdAt: row.created_at, previousVersionId: row.previous_version_id, hash: row.state_hash, inverse: row.reverse_blob, anchor: row.anchor_blob, assetIds: z.array(z.string().min(1)).parse(JSON.parse(row.asset_ids_json)), ...(row.restored_from_json ? { restoredFrom: DocumentVersionSummarySchema.shape.restoredFrom.parse(JSON.parse(row.restored_from_json)) } : {}) };
  } catch { throw new DocumentHistoryError('version_corrupt'); }
}
export function createCanvasVersionRepository(database: CanvasDatabase) {
  function readHead(documentId: string): CanvasVersionHead | null {
    const raw = database.prepare('SELECT * FROM canvas_version_heads WHERE node_id = ?').get(documentId); if (!raw) return null;
    try { const row = headSchema.parse(raw); return { latestVersionId: row.latest_version_id, sequence: row.head_sequence, changedAt: row.changed_at, dirtySince: row.dirty_since, inverse: row.reverse_blob, bytesSinceAnchor: row.bytes_since_anchor, usedBytes: row.used_bytes, overBudgetBytes: row.over_budget_bytes }; } catch { throw new DocumentHistoryError('version_corrupt'); }
  }
  function writeHead(documentId: string, head: CanvasVersionHead): void {
    database.prepare(`INSERT INTO canvas_version_heads(node_id, latest_version_id, head_sequence, changed_at, dirty_since, reverse_blob, bytes_since_anchor, used_bytes, over_budget_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET latest_version_id=excluded.latest_version_id, head_sequence=excluded.head_sequence, changed_at=excluded.changed_at, dirty_since=excluded.dirty_since, reverse_blob=excluded.reverse_blob, bytes_since_anchor=excluded.bytes_since_anchor, used_bytes=excluded.used_bytes, over_budget_bytes=excluded.over_budget_bytes`).run(documentId, head.latestVersionId, head.sequence, head.changedAt, head.dirtySince, head.inverse, head.bytesSinceAnchor, head.usedBytes, head.overBudgetBytes);
  }
  function readRecords(documentId: string): CanvasVersionRecord[] { return database.prepare('SELECT * FROM canvas_versions WHERE node_id = ? ORDER BY sequence DESC').all(documentId).map(parseRecord); }
  function readSummaries(documentId: string, head: CanvasVersionHead): DocumentVersionSummary[] {
    const schema = z.object({ version_id: z.string(), sequence: z.number(), created_at: z.number(), restored_from_json: z.string().nullable() });
    const records = database.prepare('SELECT version_id, sequence, created_at, restored_from_json FROM canvas_versions WHERE node_id = ? ORDER BY sequence DESC').all(documentId).map(raw => { const row = schema.parse(raw); return summarizeCanvasVersion({ versionId: row.version_id, sequence: row.sequence, createdAt: row.created_at, ...(row.restored_from_json ? { restoredFrom: DocumentVersionSummarySchema.shape.restoredFrom.parse(JSON.parse(row.restored_from_json)) } : {}) }, row.sequence === head.sequence); });
    if (records[0]?.versionId !== canvasVersionId(head.sequence)) records.unshift({ versionId: canvasVersionId(head.sequence), order: head.sequence + 1, createdAt: head.changedAt, isCurrent: true });
    return records;
  }
  function writeRecord(documentId: string, record: CanvasVersionRecord): void {
    database.prepare(`INSERT INTO canvas_versions(node_id, version_id, sequence, created_at, schema_version, previous_version_id, state_hash, reverse_blob, anchor_blob, asset_ids_json, restored_from_json) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT(node_id, version_id) DO UPDATE SET previous_version_id=excluded.previous_version_id, reverse_blob=excluded.reverse_blob, anchor_blob=excluded.anchor_blob`).run(documentId, record.versionId, record.sequence, record.createdAt, record.previousVersionId, record.hash, record.inverse, record.anchor, JSON.stringify(record.assetIds), record.restoredFrom ? JSON.stringify(record.restoredFrom) : null);
  }
  function retainedAssetIds(documentId: string): string[] {
    const assets = database.prepare('SELECT asset_ids_json FROM canvas_versions WHERE node_id = ?').all(documentId).flatMap(raw => z.array(z.string()).parse(JSON.parse(z.object({ asset_ids_json: z.string() }).parse(raw).asset_ids_json)));
    return [...new Set(assets)];
  }
  return { readHead, writeHead, readRecords, readSummaries, writeRecord, retainedAssetIds,
    dirtyDocuments: () => database.prepare('SELECT node_id FROM canvas_version_heads WHERE dirty_since IS NOT NULL').all().map(raw => z.object({ node_id: z.string() }).parse(raw).node_id),
    deleteExcept(documentId: string, keep: readonly string[]) { database.prepare('DELETE FROM canvas_versions WHERE node_id = ? AND version_id NOT IN (SELECT value FROM json_each(?))').run(documentId, JSON.stringify(keep)); },
  };
}
