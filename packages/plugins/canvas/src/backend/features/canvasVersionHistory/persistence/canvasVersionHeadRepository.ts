import { z } from 'zod';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type { CanvasVersionHead } from '../definitions/canvasVersionHistory';
const bytes = z.instanceof(Uint8Array).nullable();
const headSchema = z.object({
  latest_version_id: z.string(),
  head_sequence: z.number().int().nonnegative(),
  changed_at: z.number().int().nonnegative(),
  dirty_since: z.number().nullable(),
  reverse_blob: bytes,
  bytes_since_anchor: z.number(),
  used_bytes: z.number(),
  over_budget_bytes: z.number(),
});
/** 版本头是当前提交的增量边界，与已封存版本载荷分开读写。 */
export function createCanvasVersionHeadRepository(database: CanvasDatabase) {
  function readHead(documentId: string): CanvasVersionHead | null {
    const raw = database
      .prepare('SELECT * FROM canvas_version_heads WHERE node_id = ?')
      .get(documentId);
    if (!raw) return null;
    try {
      const row = headSchema.parse(raw);
      return {
        latestVersionId: row.latest_version_id,
        sequence: row.head_sequence,
        changedAt: row.changed_at,
        dirtySince: row.dirty_since,
        inverse: row.reverse_blob,
        bytesSinceAnchor: row.bytes_since_anchor,
        usedBytes: row.used_bytes,
        overBudgetBytes: row.over_budget_bytes,
      };
    } catch (cause) {
      throw new DocumentHistoryError('version_corrupt', { cause });
    }
  }
  function writeHead(documentId: string, head: CanvasVersionHead): void {
    database
      .prepare(
        `INSERT INTO canvas_version_heads (
  node_id,
  latest_version_id,
  head_sequence,
  changed_at,
  dirty_since,
  reverse_blob,
  bytes_since_anchor,
  used_bytes,
  over_budget_bytes
)
VALUES (?,
  ?,
  ?,
  ?,
  ?,
  ?,
  ?,
  ?,
  ?)
ON CONFLICT(node_id) DO UPDATE SET
  latest_version_id=excluded.latest_version_id,
  head_sequence=excluded.head_sequence,
  changed_at=excluded.changed_at,
  dirty_since=excluded.dirty_since,
  reverse_blob=excluded.reverse_blob,
  bytes_since_anchor=excluded.bytes_since_anchor,
  used_bytes=excluded.used_bytes,
  over_budget_bytes=excluded.over_budget_bytes`
      )
      .run(
        documentId,
        head.latestVersionId,
        head.sequence,
        head.changedAt,
        head.dirtySince,
        head.inverse,
        head.bytesSinceAnchor,
        head.usedBytes,
        head.overBudgetBytes
      );
  }
  function dirtyDocuments() {
    return database
      .prepare('SELECT node_id FROM canvas_version_heads WHERE dirty_since IS NOT NULL')
      .all()
      .map(raw => z.object({ node_id: z.string() }).parse(raw).node_id);
  }
  return { readHead, writeHead, dirtyDocuments };
}
