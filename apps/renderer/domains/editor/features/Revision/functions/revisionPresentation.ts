import type { EditorMessageResolver } from '../../../definitions/editorMessages'

export interface RevisionStats {
  insertCount: number
  deleteCount: number
}

export interface RevisionIndicatorTitleParams extends RevisionStats {
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

  return statsText
    ? editorMessage('editor.revision.indicator.pendingTitleWithStats', { stats: statsText })
    : editorMessage('editor.revision.indicator.pendingTitle')
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
