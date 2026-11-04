import type { CanvasElementId } from '../../../../shared';
import { validateCanvasGraph, type CanvasCommitPlan, type CanvasElementChange } from '../../../features/canvasCommit';
import type { CanvasHistoryChange } from '../definitions/canvasHistory';
import type {
  CanvasHistoryCreation, CanvasHistoryDeletion, CanvasHistoryEdit,
  CanvasHistoryReversalContext, CanvasHistoryReversalDecision, CanvasHistoryReversalInput, CanvasHistoryReversibleChange,
} from '../definitions/canvasHistoryReversal';
import { positionCanvasHistoryRestorations } from './positionCanvasHistoryRestorations';
import { findProtectedCanvasHistoryCreations } from './findProtectedCanvasHistoryCreations';
import { reverseCanvasHistoryCreation, reverseCanvasHistoryDeletion, reverseCanvasHistoryEdit } from './reverseCanvasHistoryRecords';

function isCreation(record: CanvasHistoryChange): record is CanvasHistoryCreation {
  return record.before === null && record.after !== null;
}
function isDeletion(record: CanvasHistoryChange): record is CanvasHistoryDeletion {
  return record.before !== null && record.after === null;
}
function isEdit(record: CanvasHistoryChange): record is CanvasHistoryEdit {
  return record.before !== null && record.after !== null;
}

function reverseRecord(
  record: CanvasHistoryReversibleChange,
  context: CanvasHistoryReversalContext,
  protectedCreations: ReadonlySet<CanvasElementId>
): CanvasHistoryReversalDecision {
  if (protectedCreations.has(record.id)) return { kind: 'skipped', reason: 'later_use_preserved' };
  if (isCreation(record)) return reverseCanvasHistoryCreation(record, context);
  if (isDeletion(record)) return reverseCanvasHistoryDeletion(record, context);
  return reverseCanvasHistoryEdit(record, context);
}

function dependencyOrder(records: readonly CanvasHistoryChange[]): readonly CanvasHistoryReversibleChange[] {
  const creations = records.filter(isCreation);
  const deletions = records.filter(isDeletion);
  // 先撤自己的新线再撤新卡；恢复先卡后线，不能级联吞掉别人的连接。
  return [
    ...creations.filter(record => record.after.type === 'edge'),
    ...deletions.filter(record => record.before.type !== 'edge'),
    ...records.filter(isEdit),
    ...creations.filter(record => record.after.type !== 'edge'),
    ...deletions.filter(record => record.before.type === 'edge'),
  ];
}

export function planCanvasHistoryReversal(input: CanvasHistoryReversalInput): CanvasCommitPlan {
  const rows = new Map(input.state.elements.map(row => [row.element.id, row]));
  const deleted = { ...input.state.deletedOrigins };
  const changes: CanvasElementChange[] = [];
  const results: CanvasCommitPlan['results'] = [];
  const restorationResults = new Map<CanvasElementId, number>();
  const records = [...input.entry.changes].reverse();
  const protectedCreations = findProtectedCanvasHistoryCreations(records, rows);
  const context: CanvasHistoryReversalContext = {
    rows, deletedOrigins: deleted, actor: input.actor, claims: input.claims,
    origin: input.origin, now: input.now,
  };
  for (const record of dependencyOrder(records)) {
    const decision = reverseRecord(record, context, protectedCreations);
    results.push({ index: results.length, id: record.id, status: decision.kind, reason: decision.reason, ...(decision.fieldResults ? { fieldResults: [...decision.fieldResults] } : {}) });
    if (decision.kind === 'skipped') continue;
    if (decision.row) rows.set(record.id, decision.row);
    else rows.delete(record.id);
    if (decision.deletionGuard) deleted[record.id] = decision.deletionGuard;
    changes.push(decision.change);
    if (isDeletion(record) && decision.row?.element.type !== 'edge') restorationResults.set(record.id, results.length - 1);
  }
  const positioned = positionCanvasHistoryRestorations({ rows, changes, results, restorationResults, origin: input.origin });
  validateCanvasGraph([...positioned.rows.values()].map(row => row.element));
  return {
    origin: input.origin, changes: positioned.changes, results: positioned.results, refs: {},
    retainedElements: records.flatMap(record => [record.before, record.after].flatMap(element => element ? [element] : [])),
    state: { ...input.state, deletedOrigins: deleted, sequence: input.state.sequence + (changes.length ? 1 : 0), elements: [...positioned.rows.values()] },
  };
}
