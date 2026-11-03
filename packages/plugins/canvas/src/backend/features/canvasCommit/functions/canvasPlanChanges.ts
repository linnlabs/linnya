import type { CanvasElement, CanvasElementId } from '../../../../shared';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';

export function resolveCanvasPlanElement(plan: CanvasWorkingPlan, id: string): CanvasElementId | undefined {
  if (id.startsWith('$')) return plan.refs[id];
  for (const key of plan.elements.keys()) if (key === id) return key;
  return undefined;
}

export function appendCanvasPlanChange(plan: CanvasWorkingPlan, before: CanvasElement | null, after: CanvasElement | null, fields: readonly string[]): void {
  const id = after?.id ?? before?.id;
  if (!id) throw new Error('空变更没有元素身份');
  plan.changes.push({ id, before, after, fields });
  if (after) {
    const versions = { ...plan.elements.get(id)?.fieldVersions };
    const origins = { ...plan.elements.get(id)?.fieldOrigins };
    for (const field of fields) { versions[field] = after.revision; origins[field] = plan.origin; }
    if (!before) { versions.$existence = after.revision; origins.$existence = plan.origin; }
    plan.elements.set(id, { element: after, fieldVersions: versions, fieldOrigins: origins });
  } else plan.elements.delete(id);
}

