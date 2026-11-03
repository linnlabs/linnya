import type { CanvasSnapshot } from '@plugin/canvas/shared';
export function isCanvasReadonly(snapshot: CanvasSnapshot | null): boolean { return !snapshot || Boolean(snapshot.integrity?.readOnly); }
export function requireWritableCanvas(snapshot: CanvasSnapshot | null): CanvasSnapshot {
  if (!snapshot) throw new Error('画布尚未打开');
  if (snapshot.integrity?.readOnly) throw new Error('此画布包含当前版本无法完整处理的内容，已进入只读模式');
  return snapshot;
}
