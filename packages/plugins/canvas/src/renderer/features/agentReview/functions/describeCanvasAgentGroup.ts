import type { CanvasAgentGroup } from '@plugin/canvas/shared';

/** 审阅面板的组摘要：只列非零项，用完整词而不是 +/~/− 记号。 */
export function describeCanvasAgentGroupCounts(group: CanvasAgentGroup): string {
  const parts = [
    group.added.length ? `新增 ${group.added.length}` : '',
    group.updated.length ? `修改 ${group.updated.length}` : '',
    group.deleted.length ? `删除 ${group.deleted.length}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join('、')} 张` : '没有改动';
}

/** 组标题用最后写入时间区分多组，同一天只显示时分。 */
export function describeCanvasAgentGroupTime(group: CanvasAgentGroup, now = Date.now()): string {
  const time = new Date(group.lastWriteAt || group.createdAt),
    today = new Date(now);
  const clock = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return time.toDateString() === today.toDateString()
    ? clock
    : `${time.getMonth() + 1}月${time.getDate()}日 ${clock}`;
}
