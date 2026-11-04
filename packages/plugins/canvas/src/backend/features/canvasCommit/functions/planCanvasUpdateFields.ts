import type { CanvasOperationFieldResult } from '../../../../shared';
import type { CanvasUpdateFieldContext, CanvasUpdateFieldUnit } from '../definitions/canvasUpdateFields';
import { readCanvasUpdateFieldUnits } from './readCanvasUpdateFieldUnits';

const lastWriterWins = new Set(['color', 'order', 'direction', 'lineStyle', 'linePattern']);
function unitBlockReason(context: CanvasUpdateFieldContext, unit: CanvasUpdateFieldUnit): string | null {
  const { plan, row, command } = context;
  const layout = plan.layoutTargets.has(command.id) || plan.layoutTargets.has(row.element.id);
  const protectedFields = plan.actor.source.kind === 'agent' || layout
    ? new Set(plan.claims.filter(claim => claim.elementId === row.element.id).flatMap(claim => claim.fields)) : new Set<string>();
  if ([...unit.fields, ...unit.dependencies].some(field => protectedFields.has(field))) return 'user_editing';
  if (unit.fields.some(field => !lastWriterWins.has(field) && (row.fieldVersions[field] ?? 0) > command.baseRevision)) return 'stale_field';
  if (unit.dependencies.some(field => (row.fieldVersions[field] ?? 0) > command.baseRevision && row.fieldOrigins[field] !== plan.origin)) return unit.dependencyReason;
  return null;
}
/** 同条更新按真实语义单元筛选；测高/裁剪/二维位置不能拆成错误的半份几何。 */
export function planCanvasUpdateFields(context: CanvasUpdateFieldContext): CanvasOperationFieldResult[] {
  const layout = context.plan.layoutTargets.has(context.command.id) || context.plan.layoutTargets.has(context.row.element.id);
  const units = readCanvasUpdateFieldUnits({ before: context.row.element, after: context.candidate, fields: Object.keys(context.command.patch), layout });
  const decisions = new Map(units.flatMap(unit => {
    const reason = unitBlockReason(context, unit);
    return unit.fields.map(field => [field, { field, status: reason ? 'skipped' : 'applied', reason }] as const);
  }));
  return Object.keys(context.command.patch).map(field => {
    const decision = decisions.get(field); if (!decision) throw new Error('canvas_update_field_missing'); return decision;
  });
}
