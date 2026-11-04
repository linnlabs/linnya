import type { CanvasOperationFieldResult } from '../../../../shared';
import type { CanvasUpdateFieldContext, CanvasUpdateFieldUnit } from '../definitions/canvasUpdateFields';

const lastWriterWins = new Set(['color', 'order', 'direction', 'lineStyle', 'linePattern']);
const dimensions = ['data', 'width', 'height'];
const geometry = ['x', 'y', 'width', 'height'];
function hasMeasuredText(context: CanvasUpdateFieldContext): boolean {
  const { row, candidate } = context;
  return row.element.type === 'text' && candidate.type === 'text'
    && (row.element.data.heightMode === 'auto' || candidate.data.heightMode === 'auto');
}
function hasImageGeometry(context: CanvasUpdateFieldContext): boolean {
  const { row, candidate, command } = context;
  return row.element.type === 'image' && candidate.type === 'image' && command.patch.data !== undefined
    && geometry.some(field => field in command.patch)
    && (row.element.data.assetId !== candidate.data.assetId || JSON.stringify(row.element.data.crop) !== JSON.stringify(candidate.data.crop));
}
function fieldUnits(context: CanvasUpdateFieldContext): CanvasUpdateFieldUnit[] {
  const remaining = new Set(Object.keys(context.command.patch)), units: CanvasUpdateFieldUnit[] = [];
  const take = (fields: readonly string[], dependencies: readonly string[], dependencyReason: CanvasUpdateFieldUnit['dependencyReason']) => {
    const present = fields.filter(field => remaining.delete(field));
    if (present.length) units.push({ fields: present, dependencies, dependencyReason });
  };
  if (hasImageGeometry(context)) take(['data', ...geometry], ['data', ...geometry], 'stale_geometry');
  else if (hasMeasuredText(context)) take(dimensions, ['data', 'width'], 'stale_measurement');
  if (remaining.has('width') && remaining.has('height')) take(['width', 'height'], [], 'stale_geometry');
  const layout = context.plan.layoutTargets.has(context.command.id) || context.plan.layoutTargets.has(context.row.element.id);
  take(['x', 'y'], layout ? ['width', 'height'] : [], 'stale_layout_size');
  if (remaining.has('from') && remaining.has('to')) take(['from', 'to'], [], 'stale_geometry');
  for (const field of remaining) units.push({ fields: [field], dependencies: [], dependencyReason: 'stale_geometry' });
  return units;
}
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
  const decisions = new Map(fieldUnits(context).flatMap(unit => {
    const reason = unitBlockReason(context, unit);
    return unit.fields.map(field => [field, { field, status: reason ? 'skipped' : 'applied', reason }] as const);
  }));
  return Object.keys(context.command.patch).map(field => {
    const decision = decisions.get(field); if (!decision) throw new Error('canvas_update_field_missing'); return decision;
  });
}
