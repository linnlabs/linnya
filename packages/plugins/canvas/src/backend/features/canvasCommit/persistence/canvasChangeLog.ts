import { z } from 'zod';
import { CanvasCommitDeltaSchema } from '../../../../shared';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';

export type CanvasLoggedCommit = z.infer<typeof CanvasCommitDeltaSchema> & {
  /** 提交事务内记录的 UTC 毫秒。 */
  readonly committedAt: number;
};

const RowSchema = z.object({
  sequence: z.number(),
  source_json: z.string(),
  changes_json: z.string(),
  created_at: z.number(),
});

/** 有界日志按序号升序读出；行损坏时抛出 ZodError 或 SyntaxError，由调用方决定退回快照或报不完整。 */
export function readCanvasChangeLog(
  database: Pick<CanvasDatabase, 'prepare'>,
  input: { readonly documentId: string; readonly afterSequence: number }
): CanvasLoggedCommit[] {
  return database
    .prepare(
      'SELECT sequence, source_json, changes_json, created_at FROM canvas_changes WHERE node_id = ? AND sequence > ? ORDER BY sequence'
    )
    .all(input.documentId, input.afterSequence)
    .map(value => {
      const row = RowSchema.parse(value);
      return {
        ...CanvasCommitDeltaSchema.parse({
          sequence: row.sequence,
          source: JSON.parse(row.source_json),
          changes: JSON.parse(row.changes_json),
        }),
        committedAt: row.created_at,
      };
    });
}

/** 日志仍保留的最早一条；日志被裁剪后，更早的提交只剩当前快照。 */
export function readCanvasChangeLogStart(
  database: Pick<CanvasDatabase, 'prepare'>,
  documentId: string
): { readonly sequence: number; readonly committedAt: number } | null {
  const row = z
    .object({ sequence: z.number().nullable(), created_at: z.number().nullable() })
    .parse(
      database
        .prepare(
          'SELECT sequence, created_at FROM canvas_changes WHERE node_id = ? ORDER BY sequence LIMIT 1'
        )
        .get(documentId) ?? { sequence: null, created_at: null }
    );
  return row.sequence === null || row.created_at === null
    ? null
    : { sequence: row.sequence, committedAt: row.created_at };
}

/** 某时点（含）以后的第一条提交之前的序号；没有更晚的提交时返回 null。 */
export function readCanvasSequenceBefore(
  database: Pick<CanvasDatabase, 'prepare'>,
  input: { readonly documentId: string; readonly since: number }
): number | null {
  const row = z
    .object({ sequence: z.number().nullable() })
    .parse(
      database
        .prepare(
          'SELECT MIN(sequence) AS sequence FROM canvas_changes WHERE node_id = ? AND created_at >= ?'
        )
        .get(input.documentId, input.since)
    );
  return row.sequence === null ? null : row.sequence - 1;
}
