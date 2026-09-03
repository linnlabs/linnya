import type { BlockVersion } from '../../../../../shared/ipc/blockHistoryGateway'
import type { EditorMessageResolver } from '../../../definitions/editorMessages'

/**
 * 查找当前 UI 状态选中的历史版本。
 *
 * 中文说明：Host 只需要渲染当前选中版本，具体“如何从版本列表里找选中项”的规则
 * 收束在 BlockHistory feature 内，避免 Host 直接理解版本列表结构。
 */
export function findSelectedBlockHistoryVersion(
  versions: readonly BlockVersion[],
  selectedVersionId: string | null | undefined
): BlockVersion | null {
  if (!selectedVersionId) return null
  return versions.find((version) => version.id === selectedVersionId) ?? null
}

export function readCurrentBlockHistoryVersionLabel(
  currentContentJson: string | null,
  versions: readonly BlockVersion[],
  message: EditorMessageResolver
): string {
  if (!currentContentJson) return message('editor.blockHistory.currentVersionUnsaved')
  const matched = versions.find((version) => version.content_json === currentContentJson)
  if (!matched) return message('editor.blockHistory.currentVersionUnsaved')
  return message('editor.blockHistory.currentVersion', { version: matched.version_number })
}

export function readSelectedBlockHistoryVersionLabel(
  version: BlockVersion | null,
  message: EditorMessageResolver,
  locale = 'zh-CN'
): string {
  if (!version) return message('editor.blockHistory.noSelectedVersion')

  try {
    const date = new Date(version.created_at)
    const timeText = date.toLocaleString(locale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    return message('editor.blockHistory.selectedVersionWithTime', {
      version: version.version_number,
      time: timeText,
    })
  } catch {
    return message('editor.blockHistory.selectedVersion', { version: version.version_number })
  }
}

export function readDeleteBlockHistoryVersionDialogMessage(
  version: BlockVersion | null,
  message: EditorMessageResolver
): string {
  if (!version) return message('editor.blockHistory.deleteDialog.message')
  return message('editor.blockHistory.deleteDialog.messageWithVersion', {
    version: version.version_number,
  })
}

/**
 * 判断恢复历史版本前是否需要询问“是否先保存当前内容”。
 *
 * 中文说明：这是历史模式的保护规则。当前 rootBlock 内容如果还没有对应快照，
 * 直接恢复会丢失当前编辑结果，因此必须先让用户选择。
 */
export function shouldPromptBeforeBlockHistoryRestore(params: {
  currentContentJson: string | null
  versions: readonly BlockVersion[]
}): boolean {
  const currentContentJson = params.currentContentJson
  if (!currentContentJson) return true
  return !params.versions.some((version) => version.content_json === currentContentJson)
}
