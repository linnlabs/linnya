import type { CanonicalPendingSession, RevisionStatus } from '../store/types'

export interface RevisionIndicatorSummary {
  hasPendingRevision: boolean
  status: RevisionStatus
  insertCount: number
  deleteCount: number
  createdAt?: number
  forceVisible: boolean
  pendingOnly: boolean
}

const EMPTY_REVISION_INDICATOR_SUMMARY: RevisionIndicatorSummary = {
  hasPendingRevision: false,
  status: 'pending',
  insertCount: 0,
  deleteCount: 0,
  forceVisible: false,
  pendingOnly: false,
}

/**
 * 将 canonical pending 事实源压缩成 Host 修订指示条所需的轻量摘要。
 *
 * 中文说明：Host 滚动热路径只关心“这个块有没有 pending 以及显示什么统计”，
 * 不能在这里触发文档 mark 扫描或 pending 投影。
 */
export function readRevisionIndicatorSummary(
  canonicalSession: CanonicalPendingSession | null
): RevisionIndicatorSummary {
  if (!canonicalSession) return EMPTY_REVISION_INDICATOR_SUMMARY

  const insertCount = canonicalSession.diffStats?.insertCount ?? 0
  const deleteCount = canonicalSession.diffStats?.deleteCount ?? 0
  const hasDetailedStats = canonicalSession.diffStats !== undefined

  return {
    hasPendingRevision: true,
    status: 'pending',
    insertCount,
    deleteCount,
    createdAt: canonicalSession.createdAt,
    forceVisible: true,
    pendingOnly: !hasDetailedStats,
  }
}
