import type { CanvasAgentGroup } from '@plugin/canvas/shared';
import { canvasLocale, canvasText } from '../../localization';

/** 审阅面板的组摘要：只列非零项，用完整词而不是 +/~/− 记号。 */
export function describeCanvasAgentGroupCounts(group: CanvasAgentGroup): string {
  const parts = [
    group.added.length
      ? canvasText('canvas.review.count.added', { count: group.added.length })
      : '',
    group.updated.length
      ? canvasText('canvas.review.count.updated', { count: group.updated.length })
      : '',
    group.deleted.length
      ? canvasText('canvas.review.count.deleted', { count: group.deleted.length })
      : '',
  ].filter(Boolean);
  return parts.length
    ? canvasText('canvas.review.count.suffix', {
        parts: parts.join(canvasText('canvas.list.comma')),
      })
    : canvasText('canvas.review.count.none');
}

/** 组标题用最后写入时间区分多组，同一天只显示时分。 */
export function describeCanvasAgentGroupTime(group: CanvasAgentGroup, now = Date.now()): string {
  const time = new Date(group.lastWriteAt || group.createdAt),
    today = new Date(now),
    locale = canvasLocale();
  const clock = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return time.toDateString() === today.toDateString()
    ? clock
    : canvasText('canvas.review.date', {
        date: time.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }),
        clock,
      });
}
