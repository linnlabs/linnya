import type { CanonicalPendingSession } from '../definitions/revision';

/** 失败的投影不能让读者确认未看到的内容；大文档尚未展开的提议仍可由后端整批接受。 */
export function assertPendingDecisionPreview(sessions: readonly CanonicalPendingSession[], blockId?: string): void {
  if (sessions.some(session => (!blockId || session.blockId === blockId) && session.projection === 'failed')) {
    throw new Error('这条修改无法预览，仅可拒绝');
  }
}
