import type { CanvasSnapshot } from '@plugin/canvas/shared';
export function canvasIntegrityNotice(snapshot: CanvasSnapshot | null): string | null {
  const integrity = snapshot?.integrity;
  if (!integrity) return null;
  const detail = integrity.issues
    .slice(0, 4)
    .map(issue => issue.message)
    .join('；');
  return `此画布包含当前版本无法完整处理的内容（格式 v${integrity.formatVersion}），现仅显示可识别内容并以只读方式打开。请更新应用后继续编辑。${detail}`;
}
