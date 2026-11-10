import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import {
  canvasSourceKey,
  canvasAgentSourceKey,
  saveCanvasPendingReceipt,
  finishCanvasPendingReceipts,
  retainCanvasRequestForGroup,
  releaseCanvasGroupReceipts,
  type CanvasHistoryCommitInput,
} from '../../canvasCommit';
import { captureCanvasHistory, mergeCanvasHistoryEntry } from '../../../shared/history';
import { projectCanvasSkippedFieldWrites } from '../functions/projectCanvasSkippedFieldWrites';
import { markCanvasGroupElementsReviewed } from '../functions/canvasAgentChangeRules';
import {
  CanvasAgentGroupRecordSchema,
  CanvasPendingBatchSchema,
  type CanvasAgentGroupRecord,
  type CanvasPendingBatch,
} from '../definitions/canvasAgentChanges';

type ReadDatabase = Pick<CanvasDatabase, 'prepare'>;
const jsonRow = z.object({ record_json: z.string() });
const pendingRow = z.object({ batch_json: z.string() });
export function readCanvasAgentGroup(
  database: ReadDatabase,
  documentId: string,
  groupId: string
): CanvasAgentGroupRecord | null {
  const raw = database
    .prepare('SELECT record_json FROM canvas_agent_groups WHERE node_id = ? AND group_id = ?')
    .get(documentId, groupId);
  return raw
    ? CanvasAgentGroupRecordSchema.parse(JSON.parse(jsonRow.parse(raw).record_json))
    : null;
}
export function readCanvasAgentGroups(
  database: ReadDatabase,
  documentId: string
): CanvasAgentGroupRecord[] {
  return database
    .prepare('SELECT record_json FROM canvas_agent_groups WHERE node_id = ? ORDER BY group_id')
    .all(documentId)
    .map(raw => CanvasAgentGroupRecordSchema.parse(JSON.parse(jsonRow.parse(raw).record_json)));
}
export function findCanvasAgentGroup(
  database: ReadDatabase,
  documentId: string,
  sourceKey: string
): CanvasAgentGroupRecord | null {
  const raw = database
    .prepare('SELECT record_json FROM canvas_agent_groups WHERE node_id = ? AND source_key = ?')
    .get(documentId, sourceKey);
  return raw
    ? CanvasAgentGroupRecordSchema.parse(JSON.parse(jsonRow.parse(raw).record_json))
    : null;
}
export function saveCanvasAgentGroup(database: ReadDatabase, group: CanvasAgentGroupRecord): void {
  database
    .prepare(
      `INSERT INTO canvas_agent_groups(node_id, group_id, source_key, record_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(node_id, group_id) DO UPDATE SET record_json = excluded.record_json`
    )
    .run(
      group.documentId,
      group.id,
      canvasAgentSourceKey(group.conversationId),
      JSON.stringify(group)
    );
}
export function createCanvasAgentGroup(
  documentId: string,
  conversationId: string | null,
  now: number
): CanvasAgentGroupRecord {
  return {
    id: randomUUID(),
    documentId,
    conversationId,
    runIds: [],
    createdAt: now,
    lastWriteAt: now,
    entry: { changes: [], groupId: null },
    reviewedElementIds: [],
    deletedUserCardIds: [],
    deletedAtSequence: {},
    outcomes: { complete: true, skippedWrites: [] },
  };
}
/** 组事实与正文共同提交，不从有界同步日志推导。 */
export function recordCanvasAgentCommit(
  database: ReadDatabase,
  input: CanvasHistoryCommitInput
): boolean {
  if (input.context.actor.source.kind !== 'agent') return false;
  const projection = projectCanvasSkippedFieldWrites(input.result),
    skippedWrites = projection.skippedWrites;
  if (!input.plan.changes.length && !skippedWrites.length) return false;
  const { documentId, actor, now } = input.context;
  const existing = findCanvasAgentGroup(database, documentId, canvasSourceKey(actor));
  const previous = existing ?? createCanvasAgentGroup(documentId, actor.source.conversationId, now);
  const outcomes = previous.outcomes;
  const entry = captureCanvasHistory(input.before, input.plan);
  const deletedUser = input.plan.changes.flatMap(change =>
    change.before &&
    !change.after &&
    change.before.type !== 'edge' &&
    change.before.createdBy.kind === 'user'
      ? [change.id]
      : []
  );
  const runIds = actor.source.runId
    ? [...new Set([...previous.runIds, actor.source.runId])]
    : previous.runIds;
  const deletedAtSequence = { ...previous.deletedAtSequence };
  for (const change of input.plan.changes) {
    if (change.after) delete deletedAtSequence[change.id];
    else deletedAtSequence[change.id] = input.plan.state.sequence;
  }
  saveCanvasAgentGroup(database, {
    ...previous,
    outcomes: {
      complete: outcomes.complete && projection.complete,
      skippedWrites: [...outcomes.skippedWrites, ...skippedWrites],
    },
    reviewedElementIds: previous.reviewedElementIds.filter(
      id => !input.plan.changes.some(change => change.id === id)
    ),
    deletedAtSequence,
    entry: mergeCanvasHistoryEntry(previous.entry, entry),
    lastWriteAt: input.plan.changes.length ? now : previous.lastWriteAt,
    runIds,
    deletedUserCardIds: [...new Set([...previous.deletedUserCardIds, ...deletedUser])],
  });
  if (skippedWrites.length)
    retainCanvasRequestForGroup(database, {
      documentId,
      sourceKey: canvasSourceKey(actor),
      requestId: input.context.requestId,
      groupId: previous.id,
    });
  return existing === null;
}
export function readCanvasPendingApproval(
  database: ReadDatabase,
  documentId: string,
  pendingId: string
): CanvasPendingBatch | null {
  const raw = database
    .prepare('SELECT batch_json FROM canvas_pending_approvals WHERE node_id = ? AND pending_id = ?')
    .get(documentId, pendingId);
  return raw ? CanvasPendingBatchSchema.parse(JSON.parse(pendingRow.parse(raw).batch_json)) : null;
}
export function findCanvasPendingApproval(
  database: ReadDatabase,
  documentId: string,
  groupId: string
): CanvasPendingBatch | null {
  const raw = database
    .prepare('SELECT batch_json FROM canvas_pending_approvals WHERE node_id = ? AND group_id = ?')
    .get(documentId, groupId);
  return raw ? CanvasPendingBatchSchema.parse(JSON.parse(pendingRow.parse(raw).batch_json)) : null;
}
export function clearCanvasPendingApproval(
  database: ReadDatabase,
  documentId: string,
  groupId: string,
  reason: 'denied' | 'replaced' | 'withdrawn' | 'closed'
): void {
  finishCanvasPendingReceipts(database, documentId, groupId, reason);
  database
    .prepare('DELETE FROM canvas_pending_approvals WHERE node_id = ? AND group_id = ?')
    .run(documentId, groupId);
}
export function saveCanvasPendingApproval(database: ReadDatabase, batch: CanvasPendingBatch): void {
  clearCanvasPendingApproval(
    database,
    batch.request.documentId,
    batch.approval.groupId,
    'replaced'
  );
  database
    .prepare(
      'INSERT INTO canvas_pending_approvals(node_id, pending_id, group_id, batch_json) VALUES (?, ?, ?, ?)'
    )
    .run(
      batch.request.documentId,
      batch.approval.id,
      batch.approval.groupId,
      JSON.stringify(batch)
    );
  saveCanvasPendingReceipt(database, {
    documentId: batch.request.documentId,
    sourceKey: batch.sourceKey,
    requestId: batch.request.requestId,
    payloadHash: batch.payloadHash,
    pendingId: batch.approval.id,
    groupId: batch.approval.groupId,
    now: batch.approval.createdAt,
  });
}
export function completeCanvasApproval(database: ReadDatabase, batch: CanvasPendingBatch): void {
  database
    .prepare('DELETE FROM canvas_pending_approvals WHERE node_id = ? AND pending_id = ?')
    .run(batch.request.documentId, batch.approval.id);
  const group = readCanvasAgentGroup(database, batch.request.documentId, batch.approval.groupId);
  if (group) saveCanvasAgentGroup(database, { ...group, deletedUserCardIds: [] });
}
export function deleteCanvasAgentGroup(
  database: ReadDatabase,
  documentId: string,
  groupId: string
): void {
  clearCanvasPendingApproval(database, documentId, groupId, 'closed');
  releaseCanvasGroupReceipts(database, documentId, groupId);
  database
    .prepare('DELETE FROM canvas_agent_groups WHERE node_id = ? AND group_id = ?')
    .run(documentId, groupId);
}

export function reviewCanvasAgentElement(
  database: ReadDatabase,
  input: {
    readonly documentId: string;
    readonly elementId: import('../../../../shared').CanvasElementId;
    readonly groupId?: string;
  }
): void {
  reviewCanvasAgentElements(database, { ...input, elementIds: [input.elementId] });
}

/** 一次用户提交只解析每组一次；批量拖动不能为每张卡重复改写整份持久历史。 */
export function reviewCanvasAgentElements(
  database: ReadDatabase,
  input: {
    readonly documentId: string;
    readonly elementIds: readonly import('../../../../shared').CanvasElementId[];
    readonly groupId?: string;
  }
): void {
  const ids = new Set(input.elementIds);
  if (!ids.size) return;
  const groups = input.groupId
    ? [readCanvasAgentGroup(database, input.documentId, input.groupId)]
    : readCanvasAgentGroups(database, input.documentId);
  for (const group of groups) {
    if (!group) continue;
    const reviewed = markCanvasGroupElementsReviewed(group, ids);
    if (reviewed) saveCanvasAgentGroup(database, reviewed);
  }
}

export function readCanvasPendingBatches(
  database: CanvasDatabase,
  documentId: string
): CanvasPendingBatch[] {
  return database
    .prepare('SELECT batch_json FROM canvas_pending_approvals WHERE node_id = ?')
    .all(documentId)
    .map(raw =>
      CanvasPendingBatchSchema.parse(
        JSON.parse(z.object({ batch_json: z.string() }).parse(raw).batch_json)
      )
    );
}
