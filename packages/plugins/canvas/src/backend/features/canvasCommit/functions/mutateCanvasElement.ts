import { generateKeyBetween } from 'fractional-indexing';
import { CanvasElementSchema } from '../../../../shared';
import type { CanvasCommand, CanvasOperationResult } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import { appendCanvasPlanChange, resolveCanvasPlanElement } from './canvasPlanChanges';
import type { CanvasStoredElement } from '../definitions/canvasCommit';
import { planCanvasUpdateFields } from './planCanvasUpdateFields';

type MutationCommand = Extract<CanvasCommand, { op: 'update' | 'delete' }>;
function deletionBlockReason(plan: CanvasWorkingPlan, row: CanvasStoredElement, command: Extract<CanvasCommand, { op: 'delete' }>): string | null {
  // 删除依赖整张读取基线，不能像样式字段一样接受后写；用户界面仍可删除当前选区。
  if (plan.actor.source.kind === 'agent' && command.baseRevision === undefined) return 'revision_required';
  if (command.baseRevision !== undefined && command.baseRevision !== row.element.revision) return 'stale_element';
  const respectsClaims = plan.actor.source.kind === 'agent' || plan.layoutTargets.has(command.id) || plan.layoutTargets.has(row.element.id);
  return respectsClaims && plan.claims.some(claim => claim.elementId === row.element.id && claim.fields.length) ? 'user_editing' : null;
}
function entityBlockReason(plan: CanvasWorkingPlan, row: CanvasStoredElement, command: MutationCommand): string | null {
  const unlocking = plan.actor.source.kind === 'user' && command.op === 'update' && command.patch.locked === false && Object.keys(command.patch).every(field => field === 'locked');
  if (row.element.locked && !unlocking) return 'element_locked';
  // 稳定ID被历史复活后仍是新的实例世代；样式LWW不能绕过这个边界。
  if (command.op === 'update' && (row.fieldVersions.$existence ?? 0) > command.baseRevision) return 'stale_element';
  return command.op === 'delete' ? deletionBlockReason(plan, row, command) : null;
}
function updateElement(plan: CanvasWorkingPlan, row: CanvasStoredElement, command: Extract<CanvasCommand, { op: 'update' }>): CanvasOperationResult {
  // 原始完整输入先过格式约束，不能因某字段冲突而把坏正文偷偷当作合法部分成功。
  const candidate = CanvasElementSchema.parse({ ...row.element, ...command.patch, revision: row.element.revision + 1, updatedBy: plan.actor.source, updatedAt: plan.now });
  if (command.patch.order !== undefined) generateKeyBetween(candidate.order, null);
  const fieldResults = planCanvasUpdateFields({ plan, row, command, candidate });
  const fields = fieldResults.filter(field => field.status === 'applied').map(field => field.field);
  const skipped = fieldResults.find(field => field.status === 'skipped');
  if (!fields.length) return { index: plan.results.length, id: row.element.id, status: 'skipped', reason: skipped?.reason ?? null, fieldResults };
  const accepted = new Set(fields), patch = Object.fromEntries(Object.entries(command.patch).filter(([field]) => accepted.has(field)));
  const after = CanvasElementSchema.parse({ ...row.element, ...patch, revision: row.element.revision + 1, updatedBy: plan.actor.source, updatedAt: plan.now });
  appendCanvasPlanChange(plan, row.element, after, fields);
  return { index: plan.results.length, id: row.element.id, status: 'applied', reason: skipped ? 'partial_fields_skipped' : null, fieldResults };
}
function deleteElement(plan: CanvasWorkingPlan, row: CanvasStoredElement): void {
  const current = row.element;
  appendCanvasPlanChange(plan, current, null, ['$existence']);
  if (current.type === 'edge') return;
  const attached = [...plan.elements.values()].filter(row => row.element.type === 'edge'
    && ((row.element.from.kind === 'card' && row.element.from.cardId === current.id) || (row.element.to.kind === 'card' && row.element.to.cardId === current.id)));
  for (const edge of attached) appendCanvasPlanChange(plan, edge.element, null, ['$existence']);
}
export function mutateCanvasElement(plan: CanvasWorkingPlan, command: MutationCommand): CanvasOperationResult {
  const id = resolveCanvasPlanElement(plan, command.id), row = id ? plan.elements.get(id) : undefined;
  const fields = command.op === 'update' ? Object.keys(command.patch) : ['$existence'];
  const skip = (reason: string): CanvasOperationResult => ({ index: plan.results.length, id: id ?? null, status: 'skipped', reason, fieldResults: fields.map(field => ({ field, status: 'skipped', reason })) });
  if (!id || !row) return skip('element_missing');
  const blocked = entityBlockReason(plan, row, command); if (blocked) return skip(blocked);
  if (command.op === 'update') return updateElement(plan, row, command);
  deleteElement(plan, row);
  return { index: plan.results.length, id, status: 'applied', reason: null, fieldResults: [{ field: '$existence', status: 'applied', reason: null }] };
}
