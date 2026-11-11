import { CANVAS_CHANGE_LOG_LIMIT } from '../definitions/canvasCommit';
import { CANVAS_EDITING_CLAIM_TTL_MS } from '../../../../shared';
import {
  decodeCanvasPersistedRows,
  CanvasReadOnlyFormatError,
} from '../functions/decodeCanvasPersistedRows';
import { z } from 'zod';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import {
  CanvasCommitDeltaSchema,
  type CanvasSnapshot,
  type CanvasSource,
  type CanvasElementId,
  type CanvasElement,
} from '../../../../shared';
import { type CanvasCommitResult } from '../../../../shared/changeset/definitions/canvasCommands';
import { saveCanvasCommittedReceipt } from './canvasRequestRepository';
import { readCanvasChangeLog } from './canvasChangeLog';
import type {
  CanvasCommitPlan,
  CanvasCommitState,
  CanvasEditingClaim,
} from '../definitions/canvasCommit';

const documentRowSchema = z.object({
  schema_version: z.number().int(),
  sequence: z.number().int().nonnegative(),
  next_card: z.number().int().positive(),
  next_edge: z.number().int().positive(),
  maximum_revision: z.number().int().nonnegative(),
});

export function readCanvasSequence(
  database: Pick<CanvasDatabase, 'prepare'>,
  documentId: string
): number {
  const raw = database
    .prepare('SELECT sequence FROM canvas_documents WHERE node_id = ?')
    .get(documentId);
  if (!raw) throw new Error('canvas_document_missing');
  return z.object({ sequence: z.number().int().nonnegative() }).parse(raw).sequence;
}

export function createEmptyCanvasDocument(database: CanvasDatabase, documentId: string): void {
  database.prepare('INSERT INTO canvas_documents (node_id) VALUES (?)').run(documentId);
}

export function readCanvasCommitState(
  database: Pick<CanvasDatabase, 'prepare'>,
  documentId: string
): CanvasCommitState {
  const raw = database
    .prepare(
      'SELECT schema_version, sequence, next_card, next_edge, maximum_revision FROM canvas_documents WHERE node_id = ?'
    )
    .get(documentId);
  if (!raw) throw new Error('canvas_document_missing');
  const row = documentRowSchema.parse(raw);
  const decoded = decodeCanvasPersistedRows(
    database
      .prepare(
        'SELECT element_id, element_json, field_versions_json, field_origins_json FROM canvas_elements WHERE node_id = ? ORDER BY element_id'
      )
      .all(documentId)
  );
  if (row.schema_version !== 1 || decoded.issues.length) throw new CanvasReadOnlyFormatError();
  const elements = decoded.rows;
  const guardSchema = z.object({
    element_id: z.string(),
    origin: z.string(),
    revision: z.number(),
  });
  const deletedOrigins = Object.fromEntries(
    database
      .prepare('SELECT element_id, origin, revision FROM canvas_history_guards WHERE node_id = ?')
      .all(documentId)
      .map(value => {
        const guard = guardSchema.parse(value);
        return [guard.element_id, { origin: guard.origin, revision: guard.revision }];
      })
  );
  return {
    deletedOrigins,
    maximumRevision: row.maximum_revision,
    sequence: row.sequence,
    nextCard: row.next_card,
    nextEdge: row.next_edge,
    elements,
  };
}

export function readCanvasSnapshot(
  database: Pick<CanvasDatabase, 'prepare'>,
  documentId: string
): CanvasSnapshot {
  const raw = database
    .prepare('SELECT schema_version, sequence FROM canvas_documents WHERE node_id = ?')
    .get(documentId);
  if (!raw) throw new Error('canvas_document_missing');
  const row = z
    .object({ schema_version: z.number().int(), sequence: z.number().int().nonnegative() })
    .parse(raw);
  const decoded = decodeCanvasPersistedRows(
    database
      .prepare(
        'SELECT element_id, element_json, field_versions_json, field_origins_json FROM canvas_elements WHERE node_id = ? ORDER BY element_id'
      )
      .all(documentId)
  );
  const issues = [...decoded.issues];
  if (row.schema_version !== 1)
    issues.unshift({
      elementId: null,
      code: 'future_format',
      message: '该画布格式与本版本不兼容，原始数据保留且禁止写入。',
    });
  return {
    schemaVersion: 1,
    documentId,
    sequence: row.sequence,
    elements: decoded.rows.map(item => item.element),
    ...(issues.length
      ? { integrity: { readOnly: true, formatVersion: row.schema_version, issues } }
      : {}),
  };
}

/** 只编译一次元素写入语句；删除前值按最终一次非空 before 建索引，避免逐卡反扫整批。 */
function persistCanvasElements(
  database: CanvasDatabase,
  documentId: string,
  plan: CanvasCommitPlan
): void {
  const upsert =
    database.prepare(`INSERT INTO canvas_elements (node_id, element_id, element_json, field_versions_json, field_origins_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(node_id, element_id) DO UPDATE SET
      element_json = excluded.element_json,
      field_versions_json = excluded.field_versions_json,
      field_origins_json = excluded.field_origins_json`);
  const remove = database.prepare(
    'DELETE FROM canvas_elements WHERE node_id = ? AND element_id = ?'
  );
  const release = database.prepare(
    'DELETE FROM canvas_history_guards WHERE node_id = ? AND element_id = ?'
  );
  const retain = database.prepare(
    `INSERT INTO canvas_history_guards (node_id, element_id, origin, revision)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(node_id, element_id) DO UPDATE SET
      origin = excluded.origin,
      revision = excluded.revision`
  );
  const finalRows = new Map(plan.state.elements.map(row => [row.element.id, row]));
  const beforeElements = new Map<CanvasElementId, CanvasElement>();
  for (const change of plan.changes)
    if (change.before) beforeElements.set(change.id, change.before);
  for (const id of new Set(plan.changes.map(change => change.id))) {
    const final = finalRows.get(id);
    if (final) {
      upsert.run(
        documentId,
        id,
        JSON.stringify(final.element),
        JSON.stringify(final.fieldVersions),
        JSON.stringify(final.fieldOrigins)
      );
      release.run(documentId, id);
    } else {
      remove.run(documentId, id);
      const before = beforeElements.get(id);
      if (before) retain.run(documentId, id, plan.origin, before.revision);
    }
  }
}

export function persistCanvasCommit(
  database: CanvasDatabase,
  input: {
    readonly documentId: string;
    readonly sourceKey: string;
    readonly source: CanvasSource;
    readonly plan: CanvasCommitPlan;
    readonly result: CanvasCommitResult;
    readonly payloadHash: string;
    readonly now: number;
  }
): void {
  const { plan, documentId } = input;
  persistCanvasElements(database, documentId, plan);
  // 标量只增不减；guard/版本裁剪都不承担永久元素墓碑的职责。
  const maximumRevision = plan.changes.reduce(
    (maximum, change) =>
      Math.max(maximum, change.before?.revision ?? 0, change.after?.revision ?? 0),
    0
  );
  database
    .prepare(
      'UPDATE canvas_documents SET sequence = ?, next_card = ?, next_edge = ?, maximum_revision = MAX(maximum_revision, ?) WHERE node_id = ?'
    )
    .run(
      plan.state.sequence,
      plan.state.nextCard,
      plan.state.nextEdge,
      maximumRevision,
      documentId
    );
  if (plan.changes.length > 0) {
    database
      .prepare(
        'INSERT INTO canvas_changes (node_id, sequence, source_json, changes_json, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        documentId,
        plan.state.sequence,
        JSON.stringify(input.source),
        JSON.stringify(plan.changes),
        input.now
      );
    // 同步日志有界，但请求回执独立保留；日志裁剪不能让写入重试重新执行。
    database
      .prepare('DELETE FROM canvas_changes WHERE node_id = ? AND sequence <= ?')
      .run(documentId, plan.state.sequence - CANVAS_CHANGE_LOG_LIMIT);
  }
  saveCanvasCommittedReceipt(database, { ...input, requestId: input.result.requestId });
}

export function readCanvasEditingClaims(
  database: Pick<CanvasDatabase, 'prepare'>,
  input: {
    readonly documentId: string;
    readonly viewId: string;
    readonly now: number;
  }
): CanvasEditingClaim[] {
  const rowSchema = z.object({ element_id: z.string(), fields_json: z.string() });
  return database
    .prepare(
      'SELECT element_id, fields_json FROM canvas_editing_claims WHERE node_id = ? AND view_id <> ? AND expires_at > ?'
    )
    .all(input.documentId, input.viewId, input.now)
    .map(value => {
      const row = rowSchema.parse(value);
      return {
        elementId: row.element_id,
        fields: z.array(z.string()).parse(JSON.parse(row.fields_json)),
      };
    });
}

export function updateCanvasEditingClaim(
  database: CanvasDatabase,
  input: {
    readonly documentId: string;
    readonly viewId: string;
    readonly elementId: string;
    readonly fields: readonly string[];
    readonly now: number;
  }
): void {
  if (input.fields.length === 0) {
    database
      .prepare(
        'DELETE FROM canvas_editing_claims WHERE node_id = ? AND view_id = ? AND element_id = ?'
      )
      .run(input.documentId, input.viewId, input.elementId);
  } else
    database
      .prepare(
        `INSERT INTO canvas_editing_claims (node_id, view_id, element_id, fields_json, expires_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(node_id, view_id, element_id) DO UPDATE SET fields_json = excluded.fields_json, expires_at = excluded.expires_at`
      )
      .run(
        input.documentId,
        input.viewId,
        input.elementId,
        JSON.stringify(input.fields),
        input.now + CANVAS_EDITING_CLAIM_TTL_MS
      );
}

export function releaseCanvasEditingClaims(database: CanvasDatabase, viewId: string): void {
  database.prepare('DELETE FROM canvas_editing_claims WHERE view_id = ?').run(viewId);
}

/** 删除身份只保留到用户栈/Agent组释放；长期版本通过文档修订下界保证旧写不被接纳。 */
export function pruneCanvasHistoryGuards(
  database: CanvasDatabase,
  input: { readonly documentId: string; readonly retainedIds: readonly string[] }
): void {
  database
    .prepare(
      'DELETE FROM canvas_history_guards WHERE node_id = ? AND element_id NOT IN (SELECT value FROM json_each(?))'
    )
    .run(input.documentId, JSON.stringify(input.retainedIds));
}

/** 日志只负责同步；缺口或裁剪始终退回当前正式快照。 */
export function readCanvasSynchronization(
  database: Pick<CanvasDatabase, 'prepare'>,
  input: { readonly documentId: string; readonly afterSequence: number }
): import('../../../../shared').CanvasSynchronization {
  const sequence = readCanvasSequence(database, input.documentId);
  const snapshot = () => ({
    kind: 'snapshot' as const,
    snapshot: readCanvasSnapshot(database, input.documentId),
  });
  const format = z
    .object({ schema_version: z.number().int() })
    .parse(
      database
        .prepare('SELECT schema_version FROM canvas_documents WHERE node_id = ?')
        .get(input.documentId)
    );
  if (format.schema_version !== 1 || input.afterSequence > sequence) return snapshot();
  let commits: z.infer<typeof CanvasCommitDeltaSchema>[];
  try {
    commits = readCanvasChangeLog(database, input).map(({ committedAt: _, ...commit }) => commit);
  } catch (error) {
    if (!(error instanceof z.ZodError || error instanceof SyntaxError)) throw error;
    return snapshot();
  }
  if (
    commits.length !== sequence - input.afterSequence ||
    commits.some((commit, index) => commit.sequence !== input.afterSequence + index + 1)
  )
    return snapshot();
  return {
    kind: 'delta',
    documentId: input.documentId,
    fromSequence: input.afterSequence,
    sequence,
    commits,
  };
}
