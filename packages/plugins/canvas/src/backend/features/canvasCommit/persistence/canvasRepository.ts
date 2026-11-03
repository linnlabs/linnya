import { z } from 'zod';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import { CanvasCommitDeltaSchema, CanvasElementSchema, type CanvasSnapshot, type CanvasSource } from '../../../../shared';
import { CanvasCommitResultSchema, type CanvasCommitResult } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasCommitPlan, CanvasCommitState, CanvasEditingClaim } from '../definitions/canvasCommit';

const documentRowSchema = z.object({ sequence: z.number().int().nonnegative(), next_card: z.number().int().positive(), next_edge: z.number().int().positive() });
const elementRowSchema = z.object({ element_json: z.string(), field_versions_json: z.string(), field_origins_json: z.string() });
const versionsSchema = z.record(z.string(), z.number().int().nonnegative());
const receiptRowSchema = z.object({ payload_hash: z.string(), result_json: z.string() });

export function createEmptyCanvasDocument(database: CanvasDatabase, documentId: string): void {
  database.prepare('INSERT INTO canvas_documents (node_id) VALUES (?)').run(documentId);
}

export function readCanvasCommitState(database: Pick<CanvasDatabase, 'prepare'>, documentId: string): CanvasCommitState {
  const raw = database.prepare('SELECT sequence, next_card, next_edge FROM canvas_documents WHERE node_id = ?').get(documentId);
  if (!raw) throw new Error('canvas_document_missing');
  const row = documentRowSchema.parse(raw);
  const elements = database.prepare('SELECT element_json, field_versions_json, field_origins_json FROM canvas_elements WHERE node_id = ? ORDER BY element_id').all(documentId)
    .map(value => {
      const stored = elementRowSchema.parse(value);
      return { element: CanvasElementSchema.parse(JSON.parse(stored.element_json)), fieldVersions: versionsSchema.parse(JSON.parse(stored.field_versions_json)), fieldOrigins: z.record(z.string(), z.string()).parse(JSON.parse(stored.field_origins_json)) };
    });
  const guardSchema = z.object({ element_id: z.string(), origin: z.string(), revision: z.number() });
  const deletedOrigins = Object.fromEntries(database.prepare('SELECT element_id, origin, revision FROM canvas_history_guards WHERE node_id = ?').all(documentId).map(value => { const guard = guardSchema.parse(value); return [guard.element_id, { origin: guard.origin, revision: guard.revision }]; }));
  return { deletedOrigins, sequence: row.sequence, nextCard: row.next_card, nextEdge: row.next_edge, elements };
}

export function readCanvasSnapshot(database: Pick<CanvasDatabase, 'prepare'>, documentId: string): CanvasSnapshot {
  const state = readCanvasCommitState(database, documentId);
  return { schemaVersion: 1, documentId, sequence: state.sequence, elements: state.elements.map(row => row.element) };
}

export function readCanvasReceipt(database: Pick<CanvasDatabase, 'prepare'>, input: {
  readonly documentId: string; readonly sourceKey: string; readonly requestId: string;
}): { readonly payloadHash: string; readonly result: CanvasCommitResult } | null {
  const raw = database.prepare('SELECT payload_hash, result_json FROM canvas_requests WHERE node_id = ? AND source_key = ? AND request_id = ?')
    .get(input.documentId, input.sourceKey, input.requestId);
  if (!raw) return null;
  const row = receiptRowSchema.parse(raw);
  return { payloadHash: row.payload_hash, result: CanvasCommitResultSchema.parse(JSON.parse(row.result_json)) };
}

export function persistCanvasCommit(database: CanvasDatabase, input: {
  readonly documentId: string; readonly sourceKey: string; readonly source: CanvasSource;
  readonly plan: CanvasCommitPlan; readonly result: CanvasCommitResult; readonly payloadHash: string; readonly now: number;
}): void {
  const { plan, documentId } = input;
  const finalRows = new Map(plan.state.elements.map(row => [row.element.id, row]));
  for (const id of new Set(plan.changes.map(change => change.id))) {
    const final = finalRows.get(id);
    if (final) { database.prepare(`INSERT INTO canvas_elements (node_id, element_id, element_json, field_versions_json, field_origins_json)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(node_id, element_id) DO UPDATE SET element_json = excluded.element_json, field_versions_json = excluded.field_versions_json, field_origins_json = excluded.field_origins_json`)
      .run(documentId, id, JSON.stringify(final.element), JSON.stringify(final.fieldVersions), JSON.stringify(final.fieldOrigins));
      database.prepare('DELETE FROM canvas_history_guards WHERE node_id = ? AND element_id = ?').run(documentId, id);
    }
    else {
      database.prepare('DELETE FROM canvas_elements WHERE node_id = ? AND element_id = ?').run(documentId, id);
      const before = [...plan.changes].reverse().find(change => change.id === id && change.before)?.before;
      if (before) database.prepare('INSERT INTO canvas_history_guards (node_id, element_id, origin, revision) VALUES (?, ?, ?, ?) ON CONFLICT(node_id, element_id) DO UPDATE SET origin = excluded.origin, revision = excluded.revision').run(documentId, id, plan.origin, before.revision);
    }
  }
  database.prepare('UPDATE canvas_documents SET sequence = ?, next_card = ?, next_edge = ? WHERE node_id = ?')
    .run(plan.state.sequence, plan.state.nextCard, plan.state.nextEdge, documentId);
  if (plan.changes.length > 0) {
    database.prepare('INSERT INTO canvas_changes (node_id, sequence, source_json, changes_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(documentId, plan.state.sequence, JSON.stringify(input.source), JSON.stringify(plan.changes), input.now);
    // 同步日志有界，但请求回执独立保留；日志裁剪不能让写入重试重新执行。
    database.prepare('DELETE FROM canvas_changes WHERE node_id = ? AND sequence <= ?').run(documentId, plan.state.sequence - 512);
  }
  database.prepare('INSERT INTO canvas_requests (node_id, source_key, request_id, payload_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(documentId, input.sourceKey, input.result.requestId, input.payloadHash, JSON.stringify(input.result), input.now);
}

export function readCanvasEditingClaims(database: Pick<CanvasDatabase, 'prepare'>, input: {
  readonly documentId: string; readonly viewId: string; readonly now: number;
}): CanvasEditingClaim[] {
  const rowSchema = z.object({ element_id: z.string(), fields_json: z.string() });
  return database.prepare('SELECT element_id, fields_json FROM canvas_editing_claims WHERE node_id = ? AND view_id <> ? AND expires_at > ?')
    .all(input.documentId, input.viewId, input.now).map(value => {
      const row = rowSchema.parse(value);
      return { elementId: row.element_id, fields: z.array(z.string()).parse(JSON.parse(row.fields_json)) };
    });
}

export function updateCanvasEditingClaim(database: CanvasDatabase, input: {
  readonly documentId: string; readonly viewId: string; readonly elementId: string;
  readonly fields: readonly string[]; readonly now: number;
}): void {
  if (input.fields.length === 0) {
    database.prepare('DELETE FROM canvas_editing_claims WHERE node_id = ? AND view_id = ? AND element_id = ?')
      .run(input.documentId, input.viewId, input.elementId);
  } else database.prepare(`INSERT INTO canvas_editing_claims (node_id, view_id, element_id, fields_json, expires_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(node_id, view_id, element_id) DO UPDATE SET fields_json = excluded.fields_json, expires_at = excluded.expires_at`)
    .run(input.documentId, input.viewId, input.elementId, JSON.stringify(input.fields), input.now + 10_000);
}

/** 日志只负责同步；缺口或裁剪始终退回当前正式快照。 */
export function readCanvasSynchronization(database: Pick<CanvasDatabase, 'prepare'>, input: { readonly documentId: string; readonly afterSequence: number }): import('../../../../shared').CanvasSynchronization {
  const snapshot = readCanvasSnapshot(database, input.documentId);
  if (input.afterSequence > snapshot.sequence) return { kind: 'snapshot', snapshot };
  const rows = database.prepare('SELECT sequence, source_json, changes_json FROM canvas_changes WHERE node_id = ? AND sequence > ? ORDER BY sequence').all(input.documentId, input.afterSequence);
  const schema = z.object({ sequence: z.number(), source_json: z.string(), changes_json: z.string() });
  const commits = rows.map(value => { const row = schema.parse(value); return CanvasCommitDeltaSchema.parse({ sequence: row.sequence, source: JSON.parse(row.source_json), changes: JSON.parse(row.changes_json) }); });
  if (commits.length !== snapshot.sequence - input.afterSequence || commits.some((commit, index) => commit.sequence !== input.afterSequence + index + 1)) return { kind: 'snapshot', snapshot };
  return { kind: 'delta', documentId: input.documentId, fromSequence: input.afterSequence, sequence: snapshot.sequence, commits };
}
