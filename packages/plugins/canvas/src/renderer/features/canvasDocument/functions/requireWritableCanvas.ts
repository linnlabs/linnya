import type { CanvasSnapshot } from '@plugin/canvas/shared';
import { canvasText } from '../../localization';
export function isCanvasReadonly(snapshot: CanvasSnapshot | null): boolean {
  return !snapshot || Boolean(snapshot.integrity?.readOnly);
}
export function requireWritableCanvas(snapshot: CanvasSnapshot | null): CanvasSnapshot {
  if (!snapshot) throw new Error(canvasText('canvas.error.notOpen'));
  if (snapshot.integrity?.readOnly) throw new Error(canvasText('canvas.error.readOnlyFormat'));
  return snapshot;
}
