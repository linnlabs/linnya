import { CanvasCardIdSchema, CanvasLayoutOptionsSchema, type CanvasCommand, type CanvasElementId, type CanvasLayoutResult } from '../../../../shared';
import type { CanvasArrangeOptions } from '../../../../shared/cli/definitions/canvasCli';

/** 临时名字在提交事务内才获得最终ID，不能把worker预测ID当成已分配身份。 */
export function resolveCanvasLayoutOptions(options: CanvasArrangeOptions, refs: Readonly<Record<string, CanvasElementId>>) {
  const resolve = (id: string) => CanvasCardIdSchema.parse(id.startsWith('$') ? refs[id] : id);
  return CanvasLayoutOptionsSchema.parse({ ...options, elementIds: options.elementIds?.map(resolve), groups: options.groups?.map(group => group.map(resolve)) });
}
export function bindCanvasLayout(layout: CanvasLayoutResult, refs: Readonly<Record<string, CanvasElementId>>, groups: readonly (readonly string[])[] = []) {
  const logical = new Map(Object.entries(refs).map(([ref, id]) => [id, ref]));
  const name = (id: string) => logical.get(CanvasCardIdSchema.parse(id)) ?? id;
  const moved = new Set<string>(layout.operations.map(move => move.id));
  const assigned = new Set<string>();
  const layoutGroups = groups.map(group => group.filter(id => moved.has(id))).filter(group => group.length).map(group => {
    for (const id of group) assigned.add(id); return group.map(name);
  });
  const remaining = [...moved].filter(id => !assigned.has(id));
  if (remaining.length) layoutGroups.push(remaining.map(name));
  const operations: CanvasCommand[] = layout.operations.map(move => ({ ...move, id: name(move.id) }));
  return { operations, layoutGroups };
}
