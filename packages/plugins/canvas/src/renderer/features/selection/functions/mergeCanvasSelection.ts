import type { CanvasCardId } from '@plugin/canvas/shared';

export function mergeCanvasSelection(
  current: readonly CanvasCardId[],
  ids: readonly CanvasCardId[],
  additive: boolean
): readonly CanvasCardId[] {
  if (!additive) return [...ids];
  const selected = new Set(current);
  for (const id of ids) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  return [...selected];
}
