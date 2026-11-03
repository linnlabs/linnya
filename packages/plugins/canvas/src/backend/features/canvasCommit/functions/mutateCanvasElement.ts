import { CanvasElementSchema } from '../../../../shared';
import type { CanvasCommand, CanvasOperationResult } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import { appendCanvasPlanChange, resolveCanvasPlanElement } from './canvasPlanChanges';
import type { CanvasStoredElement } from '../definitions/canvasCommit';

type MutationCommand = Extract<CanvasCommand, { op: 'update' | 'delete' }>;

function mutationBlockReason(plan: CanvasWorkingPlan, row: CanvasStoredElement, command: MutationCommand): string | null {
  const id = row.element.id;
  const unlocking = plan.actor.source.kind === 'user' && command.op === 'update' && command.patch.locked === false && Object.keys(command.patch).every(field => field === 'locked');
  if (row.element.locked && !unlocking) return 'element_locked';
  const fields = command.op === 'update' ? Object.keys(command.patch) : ['$existence'];
  const protectedFields = plan.claims.filter(claim => claim.elementId === id).flatMap(claim => claim.fields);
  const respectsClaims = plan.actor.source.kind === 'agent' || plan.layoutTargets.has(command.id) || plan.layoutTargets.has(id);
  const intersectsClaims = command.op === 'delete' ? protectedFields.length > 0 : fields.some(field => protectedFields.includes(field));
  return respectsClaims && intersectsClaims ? 'user_editing' : null;
}

function updateElement(plan: CanvasWorkingPlan, row: CanvasStoredElement, command: Extract<CanvasCommand, { op: 'update' }>): string | null {
  const fields = Object.keys(command.patch);
  // 布局依赖测量时尺寸；后来长高的卡不能按旧尺寸挤进新位置。
  const layoutTarget = plan.layoutTargets.has(command.id) || plan.layoutTargets.has(row.element.id);
  if (layoutTarget && ['width', 'height'].some(field => (row.fieldVersions[field] ?? 0) > command.baseRevision && row.fieldOrigins[field] !== plan.origin)) return 'stale_layout_size';
  // 位置/颜色独立变更不应让正文冲突。
  if (fields.some(field => (row.fieldVersions[field] ?? 0) > command.baseRevision)) return 'stale_field';
  const after = CanvasElementSchema.parse({ ...row.element, ...command.patch,
    revision: row.element.revision + 1, updatedBy: plan.actor.source, updatedAt: plan.now });
  appendCanvasPlanChange(plan, row.element, after, fields);
  return null;
}

function deleteElement(plan: CanvasWorkingPlan, row: CanvasStoredElement, command: Extract<CanvasCommand, { op: 'delete' }>): string | null {
  const current = row.element;
  if (command.baseRevision !== undefined && command.baseRevision !== current.revision) return 'stale_element';
  appendCanvasPlanChange(plan, current, null, ['$existence']);
  if (current.type === 'edge') return null;
  const attached = [...plan.elements.values()].filter(row => row.element.type === 'edge'
    && ((row.element.from.kind === 'card' && row.element.from.cardId === current.id)
      || (row.element.to.kind === 'card' && row.element.to.cardId === current.id)));
  for (const edge of attached) appendCanvasPlanChange(plan, edge.element, null, ['$existence']);
  return null;
}

export function mutateCanvasElement(plan: CanvasWorkingPlan, command: MutationCommand): CanvasOperationResult {
  const id = resolveCanvasPlanElement(plan, command.id);
  const row = id ? plan.elements.get(id) : undefined;
  const skip = (reason: string): CanvasOperationResult => ({ index: plan.results.length, id: id ?? null, status: 'skipped', reason });
  if (!id || !row) return skip('element_missing');
  const blocked = mutationBlockReason(plan, row, command);
  if (blocked) return skip(blocked);
  const conflict = command.op === 'update' ? updateElement(plan, row, command) : deleteElement(plan, row, command);
  if (conflict) return skip(conflict);
  return { index: plan.results.length, id, status: 'applied', reason: null };
}

