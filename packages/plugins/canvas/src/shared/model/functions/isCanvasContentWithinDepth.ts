import { CANVAS_CONTENT_MAX_DEPTH } from '../definitions/canvasContentLimits';

/** 包括attrs/marks中的JSON，不能只检查content而漏掉递归属性。 */
export function isCanvasContentWithinDepth(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth > CANVAS_CONTENT_MAX_DEPTH) return false;
    if (typeof current.value !== 'object' || current.value === null) continue;
    for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}
