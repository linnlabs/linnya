import {
  CanvasElementSchema,
  fitCanvasSection,
  isCanvasSection,
  readCanvasSectionMembers,
  type CanvasElement,
  type CanvasElementId,
  type CanvasRectangle,
} from '../../../../shared';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import type { CanvasElementChange } from '../definitions/canvasCommit';
import { appendCanvasPlanChange } from './canvasPlanChanges';
import { findCanvasPlacement } from './findCanvasPlacement';
import { placeCanvasCardInSection } from './placeCanvasCardInSection';

const centerInside = (card: CanvasRectangle, area: CanvasRectangle) =>
  card.x + card.width / 2 >= area.x &&
  card.x + card.width / 2 <= area.x + area.width &&
  card.y + card.height / 2 >= area.y &&
  card.y + card.height / 2 <= area.y + area.height;

/**
 * 分区规则的结果并入本批：同一元素已在本批变化时合并进原变化，不额外增加修订；
 * 否则作为一次新的系统变化，来源记为本批操作者。
 */
export function amendCanvasPlanElement(
  plan: CanvasWorkingPlan,
  id: CanvasElementId,
  patch: Partial<Record<'x' | 'y' | 'width' | 'height' | 'parentId', unknown>>,
  fields: readonly string[]
): void {
  const row = plan.elements.get(id);
  if (!row || !fields.length) return;
  let index = -1;
  for (let i = plan.changes.length - 1; i >= 0; i--)
    if (plan.changes[i].id === id && plan.changes[i].after) {
      index = i;
      break;
    }
  if (index < 0) {
    appendCanvasPlanChange(
      plan,
      row.element,
      CanvasElementSchema.parse({
        ...row.element,
        ...patch,
        revision: row.element.revision + 1,
        updatedBy: plan.actor.source,
        updatedAt: plan.now,
      }),
      fields
    );
    return;
  }
  const change = plan.changes[index];
  const after: CanvasElement = CanvasElementSchema.parse({ ...row.element, ...patch });
  plan.changes[index] = { ...change, after, fields: [...new Set([...change.fields, ...fields])] };
  const versions = { ...row.fieldVersions },
    origins = { ...row.fieldOrigins };
  for (const field of fields) {
    versions[field] = after.revision;
    origins[field] = plan.origin;
  }
  plan.elements.set(id, { element: after, fieldVersions: versions, fieldOrigins: origins });
}

function regroupedPosition(plan: CanvasWorkingPlan, change: CanvasElementChange) {
  const card = plan.elements.get(change.id)?.element;
  if (!card || card.type === 'edge' || change.before?.type === 'edge') return null;
  const target = card.parentId ? plan.elements.get(card.parentId)?.element : undefined;
  if (target?.type === 'section')
    return centerInside(card, target)
      ? null
      : placeCanvasCardInSection(plan, card, target, card.id);
  const previousId = change.before?.parentId;
  const previous = previousId ? plan.elements.get(previousId)?.element : undefined;
  if (previous?.type !== 'section' || !centerInside(card, previous)) return null;
  const occupied = [...plan.elements.values()].flatMap(row =>
    row.element.type === 'edge' || row.element.id === card.id ? [] : [row.element]
  );
  return findCanvasPlacement({ ...card, near: previous, side: 'right', occupied });
}

/**
 * 只改归属、没给位置时（Agent 不能给坐标）替它挪位：放进分区就排进区内空位，
 * 移出分区仍压在原区上就挪到原区右侧，免得看起来还在区里。
 */
function relocateRegrouped(plan: CanvasWorkingPlan): void {
  for (const change of [...plan.changes]) {
    if (!change.before || !change.after || !change.fields.includes('parentId')) continue;
    if (change.fields.some(field => field === 'x' || field === 'y')) continue;
    const position = regroupedPosition(plan, change);
    if (position) amendCanvasPlanElement(plan, change.id, position, ['x', 'y']);
  }
}

/** 删除分区只删分区本身：成员留在原位并离开分区。随后每个分区向外长到包住全部成员。 */
export function fitCanvasPlanSections(plan: CanvasWorkingPlan): void {
  relocateRegrouped(plan);
  const deleted = new Set(
    plan.changes.filter(change => change.after === null).map(change => change.id)
  );
  for (const { element } of [...plan.elements.values()])
    if (element.type !== 'edge' && element.parentId && deleted.has(element.parentId))
      amendCanvasPlanElement(plan, element.id, { parentId: null }, ['parentId']);
  const elements = [...plan.elements.values()].map(row => row.element);
  const members = readCanvasSectionMembers(elements);
  for (const section of elements.filter(isCanvasSection)) {
    const fitted = fitCanvasSection(section, members.get(section.id) ?? []);
    const fields = (['x', 'y', 'width', 'height'] as const).filter(
      field => fitted[field] !== section[field]
    );
    amendCanvasPlanElement(plan, section.id, fitted, fields);
  }
}
