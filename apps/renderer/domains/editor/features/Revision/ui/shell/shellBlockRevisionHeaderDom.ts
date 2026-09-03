import type { LinnyaLocale } from '@app/localization'
import type { EditorMessageResolver } from '../../../../definitions/editorMessages'
import {
  formatRevisionIndicatorTitle,
  formatRevisionTimeLabel,
} from '../../functions/revisionPresentation'

export const ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR =
  'data-root-block-shell-revision-header'
export const ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR =
  'data-root-block-shell-revision-header-active'

/**
 * Shell header 的最小渲染契约。
 *
 * 中文说明：
 * - header 是“块上还有待处理修订”的视觉表达，不应该绑定到后端 DTO 或 mark 投影层任一具体结构；
 * - canonical pending 和 active revisionMark 都能归一成这个轻量模型，避免投影前后 UI 被卸载。
 */
export interface ShellRevisionHeaderSession {
  blockId: string
  createdAt: number
  diffStats?: {
    insertCount: number
    deleteCount: number
  }
}

interface ShellRevisionHeaderViewModel {
  blockId: string
  insertCount: number
  deleteCount: number
  createdAt: number
  hasDetailedStats: boolean
}

export interface ShellRevisionHeaderRenderOptions {
  locale: LinnyaLocale
  editorMessage: EditorMessageResolver
}

function toViewModel(session: ShellRevisionHeaderSession): ShellRevisionHeaderViewModel {
  return {
    blockId: session.blockId,
    insertCount: session.diffStats?.insertCount ?? 0,
    deleteCount: session.diffStats?.deleteCount ?? 0,
    createdAt: session.createdAt,
    hasDetailedStats: typeof session.diffStats === 'object',
  }
}

function buildRenderKey(
  viewModel: ShellRevisionHeaderViewModel,
  locale: LinnyaLocale
): string {
  return [
    locale,
    viewModel.blockId,
    viewModel.insertCount,
    viewModel.deleteCount,
    viewModel.createdAt,
    viewModel.hasDetailedStats ? 'stats' : 'pending',
  ].join('|')
}

function buildTitle(
  viewModel: ShellRevisionHeaderViewModel,
  editorMessage: EditorMessageResolver
): string {
  return formatRevisionIndicatorTitle({
    status: 'pending',
    insertCount: viewModel.insertCount,
    deleteCount: viewModel.deleteCount,
    hasDetailedStats: viewModel.hasDetailedStats,
  }, editorMessage)
}

function createTextSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  return span
}

function createIndicator(
  viewModel: ShellRevisionHeaderViewModel,
  editorMessage: EditorMessageResolver
): HTMLElement {
  const indicator = document.createElement('div')
  indicator.className = 'shell-revision-indicator is-pending'
  indicator.title = buildTitle(viewModel, editorMessage)

  indicator.append(createTextSpan(
    'shell-revision-label',
    editorMessage('editor.revision.indicator.label')
  ))

  if (viewModel.insertCount > 0) {
    indicator.append(createTextSpan('shell-revision-insert', `+${viewModel.insertCount}`))
  }
  if (viewModel.insertCount > 0 && viewModel.deleteCount > 0) {
    indicator.append(createTextSpan('shell-revision-separator', '/'))
  }
  if (viewModel.deleteCount > 0) {
    indicator.append(createTextSpan('shell-revision-delete', `-${viewModel.deleteCount}`))
  }
  if (!viewModel.hasDetailedStats) {
    indicator.append(createTextSpan(
      'shell-revision-pending',
      editorMessage('editor.revision.indicator.pending')
    ))
  }

  const formattedTime = formatRevisionTimeLabel(viewModel.createdAt, editorMessage)
  if (formattedTime) {
    indicator.append(createTextSpan('shell-revision-time', formattedTime))
  }

  return indicator
}

export function findShellRevisionHeader(outer: HTMLElement): HTMLElement | null {
  return outer.querySelector<HTMLElement>(
    `[${ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR}="true"]`
  )
}

export function clearShellRevisionHeader(outer: HTMLElement): boolean {
  const header = findShellRevisionHeader(outer)
  if (!header) return false

  const hadContent = header.childElementCount > 0 || !header.hidden
  header.replaceChildren()
  header.hidden = true
  header.removeAttribute('data-render-key')
  header.removeAttribute('aria-label')
  outer.removeAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR)
  return hadContent
}

export function renderShellRevisionHeader(
  outer: HTMLElement,
  session: ShellRevisionHeaderSession,
  options: ShellRevisionHeaderRenderOptions
): boolean {
  const header = findShellRevisionHeader(outer)
  if (!header) return false

  const viewModel = toViewModel(session)
  const renderKey = buildRenderKey(viewModel, options.locale)
  if (header.dataset.renderKey === renderKey && !header.hidden) return false

  header.replaceChildren(createIndicator(viewModel, options.editorMessage))
  header.hidden = false
  header.dataset.renderKey = renderKey
  header.setAttribute('aria-label', buildTitle(viewModel, options.editorMessage))
  outer.setAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR, 'true')
  return true
}
