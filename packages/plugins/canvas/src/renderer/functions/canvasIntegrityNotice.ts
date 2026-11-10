import type { CanvasSnapshot } from '@plugin/canvas/shared';
import { canvasText } from '../features/localization';
export function canvasIntegrityNotice(snapshot: CanvasSnapshot | null): string | null {
  const integrity = snapshot?.integrity;
  if (!integrity) return null;
  // 问题明细来自后端诊断，保持原文。
  const detail = integrity.issues
    .slice(0, 4)
    .map(issue => issue.message)
    .join(canvasText('canvas.list.separator'));
  return canvasText('canvas.status.integrity', { version: integrity.formatVersion, detail });
}
