import type { EditorMessageResolver } from '../../../definitions/editorMessages'
import type { RevisionStatus } from '../store/types'

export interface RevisionStats {
  insertCount: number
  deleteCount: number
}

export interface RevisionIndicatorTitleParams extends RevisionStats {
  status: RevisionStatus
  hasDetailedStats: boolean
}

export function formatRevisionBlockCount(
  count: number,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage('editor.revision.global.blockCount', { count })
}

export function formatRevisionStatsParts(
  stats: RevisionStats,
  editorMessage: EditorMessageResolver,
): string[] {
  const parts: string[] = []

  if (stats.insertCount > 0) {
    parts.push(editorMessage('editor.revision.indicator.insertStat', { count: stats.insertCount }))
  }
  if (stats.deleteCount > 0) {
    parts.push(editorMessage('editor.revision.indicator.deleteStat', { count: stats.deleteCount }))
  }

  return parts
}

export function formatRevisionIndicatorTitle(
  params: RevisionIndicatorTitleParams,
  editorMessage: EditorMessageResolver,
): string {
  if (!params.hasDetailedStats) {
    return editorMessage('editor.revision.indicator.pendingTitleDeferred')
  }

  const statsText = formatRevisionStatsParts(params, editorMessage)
    .join(editorMessage('editor.revision.indicator.statsSeparator'))

  if (params.status === 'pending') {
    return statsText
      ? editorMessage('editor.revision.indicator.pendingTitleWithStats', { stats: statsText })
      : editorMessage('editor.revision.indicator.pendingTitle')
  }

  if (params.status === 'applied') {
    return editorMessage('editor.revision.indicator.appliedTitle', { stats: statsText })
  }

  return editorMessage('editor.revision.indicator.discardedTitle', { stats: statsText })
}

export function resolveRevisionMarkAcceptTitle(
  changeType: 'insert' | 'delete',
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage(
    changeType === 'insert'
      ? 'editor.revision.mark.acceptInsert'
      : 'editor.revision.mark.acceptDelete',
  )
}

export function resolveRevisionMarkRejectTitle(
  changeType: 'insert' | 'delete',
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage(
    changeType === 'insert'
      ? 'editor.revision.mark.rejectInsert'
      : 'editor.revision.mark.rejectDelete',
  )
}

export function formatRevisionTimeLabel(
  timestamp: number | undefined,
  editorMessage: EditorMessageResolver,
): string {
  if (!timestamp) return ''

  const date = new Date(timestamp)
  const now = new Date()
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysDiff = Math.floor((nowOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24))

  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')

  if (daysDiff === 0) {
    return `${hours}:${minutes}:${seconds}`
  }

  if (daysDiff === 1) {
    return editorMessage('editor.revision.time.yesterday')
  }

  if (year === now.getFullYear()) {
    return `${month}-${day}`
  }

  return `${year}-${month}-${day}`
}
