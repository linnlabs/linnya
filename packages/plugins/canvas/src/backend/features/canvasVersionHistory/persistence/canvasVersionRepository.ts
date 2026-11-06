import { createCanvasVersionHeadRepository } from './canvasVersionHeadRepository';
import { canvasVersionId, summarizeCanvasVersion } from '../functions/canvasVersionIdentity';
import { z } from 'zod';
import { DocumentVersionSummarySchema, type DocumentVersionSummary } from '@app/schemas';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type { CanvasVersionHead, CanvasVersionRecord } from '../definitions/canvasVersionHistory';
const bytes = z.instanceof(Uint8Array).nullable();
const recordSchema = z.object({
  version_id: z.string(),
  sequence: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  schema_version: z.literal(1),
  previous_version_id: z.string().nullable(),
  state_hash: z.string(),
  reverse_blob: bytes,
  anchor_blob: bytes,
  asset_ids_json: z.string(),
  restored_from_json: z.string().nullable(),
});
function parseRecord(value: unknown): CanvasVersionRecord {
  try {
    const row = recordSchema.parse(value);
    return {
      versionId: row.version_id,
      sequence: row.sequence,
      createdAt: row.created_at,
      previousVersionId: row.previous_version_id,
      hash: row.state_hash,
      inverse: row.reverse_blob,
      anchor: row.anchor_blob,
      assetIds: z.array(z.string().min(1)).parse(JSON.parse(row.asset_ids_json)),
      ...(row.restored_from_json
        ? {
            restoredFrom: DocumentVersionSummarySchema.shape.restoredFrom.parse(
              JSON.parse(row.restored_from_json)
            ),
          }
        : {}),
    };
  } catch (cause) {
    throw new DocumentHistoryError('version_corrupt', { cause });
  }
}
export function createCanvasVersionRepository(database: CanvasDatabase) {
  const head = createCanvasVersionHeadRepository(database);
  function readRecords(documentId: string): CanvasVersionRecord[] {
    return database
      .prepare('SELECT * FROM canvas_versions WHERE node_id = ? ORDER BY sequence DESC')
      .all(documentId)
      .map(parseRecord);
  }
  function readSummaries(documentId: string, head: CanvasVersionHead): DocumentVersionSummary[] {
    const schema = z.object({
      version_id: z.string(),
      sequence: z.number(),
      created_at: z.number(),
      restored_from_json: z.string().nullable(),
    });
    const records = database
      .prepare(
        'SELECT version_id, sequence, created_at, restored_from_json FROM canvas_versions WHERE node_id = ? ORDER BY sequence DESC'
      )
      .all(documentId)
      .map(raw => {
        const row = schema.parse(raw);
        return summarizeCanvasVersion(
          {
            versionId: row.version_id,
            sequence: row.sequence,
            createdAt: row.created_at,
            ...(row.restored_from_json
              ? {
                  restoredFrom: DocumentVersionSummarySchema.shape.restoredFrom.parse(
                    JSON.parse(row.restored_from_json)
                  ),
                }
              : {}),
          },
          row.sequence === head.sequence
        );
      });
    if (records[0]?.versionId !== canvasVersionId(head.sequence))
      records.unshift({
        versionId: canvasVersionId(head.sequence),
        order: head.sequence + 1,
        createdAt: head.changedAt,
        isCurrent: true,
      });
    return records;
  }
  function writeRecord(documentId: string, record: CanvasVersionRecord): void {
    database
      .prepare(
        `INSERT INTO canvas_versions (
  node_id,
  version_id,
  sequence,
  created_at,
  schema_version,
  previous_version_id,
  state_hash,
  reverse_blob,
  anchor_blob,
  asset_ids_json,
  restored_from_json
)
VALUES (?,
  ?,
  ?,
  ?,
  1,
  ?,
  ?,
  ?,
  ?,
  ?,
  ?)
ON CONFLICT(node_id,
  version_id) DO UPDATE SET
  previous_version_id=excluded.previous_version_id,
  reverse_blob=excluded.reverse_blob,
  anchor_blob=excluded.anchor_blob`
      )
      .run(
        documentId,
        record.versionId,
        record.sequence,
        record.createdAt,
        record.previousVersionId,
        record.hash,
        record.inverse,
        record.anchor,
        JSON.stringify(record.assetIds),
        record.restoredFrom ? JSON.stringify(record.restoredFrom) : null
      );
  }
  function retainedAssetIds(documentId: string): string[] {
    const assets = database
      .prepare('SELECT asset_ids_json FROM canvas_versions WHERE node_id = ?')
      .all(documentId)
      .flatMap(raw =>
        z
          .array(z.string())
          .parse(JSON.parse(z.object({ asset_ids_json: z.string() }).parse(raw).asset_ids_json))
      );
    return [...new Set(assets)];
  }
  return {
    ...head,
    readRecords,
    readSummaries,
    writeRecord,
    retainedAssetIds,
    deleteExcept(documentId: string, keep: readonly string[]) {
      database
        .prepare(
          'DELETE FROM canvas_versions WHERE node_id = ? AND version_id NOT IN (SELECT value FROM json_each(?))'
        )
        .run(documentId, JSON.stringify(keep));
    },
  };
}
