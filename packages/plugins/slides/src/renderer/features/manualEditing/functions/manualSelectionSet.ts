import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import type { RenderNodeSelectionRect } from '../../renderNodeSelection';
import { rectsIntersect } from '../../renderNodeSelection';

/** 作者父级和其后代只能选一个；优先保留外层，避免同一渲染成员被移动两次。 */
export function normalizeManualSelection(targets: readonly ManualEditableTarget[]): readonly ManualEditableTarget[] {
  const unique = [...new Map(targets.map(target => [target.elementId, target])).values()];
  const keys = new Set(unique.map(target => `${target.authoringRef.slideKey}/${target.authoringRef.editKey}`));
  return unique.filter(target => !target.authoringAncestorRefs.some(parent => keys.has(`${parent.slideKey}/${parent.editKey}`)));
}
export function toggleManualSelection(current: readonly ManualEditableTarget[], target: ManualEditableTarget): readonly ManualEditableTarget[] {
  return current.some(entry => entry.elementId === target.elementId)
    ? current.filter(entry => entry.elementId !== target.elementId)
    : normalizeManualSelection([...current, target]);
}
export function collectManualMarqueeSelection(targets: readonly ManualEditableTarget[], rect: RenderNodeSelectionRect, baseline: readonly ManualEditableTarget[]): readonly ManualEditableTarget[] {
  return normalizeManualSelection([...baseline, ...targets.filter(target => rectsIntersect(target.bounds, rect))]);
}
/** 多选的层级上下文：成员路径的共同祖先，不含成员自身；后续点击据此停在同一层。 */
export function manualSelectionContext(paths: readonly (readonly ManualEditableTarget[])[]): readonly ManualEditableTarget[] {
  const [first, ...rest] = paths;
  if (!first) return [];
  let length = first.length - 1;
  for (const path of rest) {
    let index = 0;
    while (index < Math.min(length, path.length - 1) && path[index]?.elementId === first[index]?.elementId) index += 1;
    length = index;
  }
  return first.slice(0, Math.max(length, 0));
}
export function manualSelectionBounds(targets: readonly ManualEditableTarget[]): RenderNodeSelectionRect | null {
  if (targets.length === 0) return null;
  const left = Math.min(...targets.map(target => target.bounds.x));
  const top = Math.min(...targets.map(target => target.bounds.y));
  return { x: left, y: top, w: Math.max(...targets.map(target => target.bounds.x + target.bounds.w)) - left,
    h: Math.max(...targets.map(target => target.bounds.y + target.bounds.h)) - top };
}
