/**
 * refreshReason.ts
 *
 * RootBlock 渲染虚拟化刷新原因的类型化入口。
 *
 * 中文说明：
 * - Engine 过去用字符串 includes 判断 scroll-jump / editor-scroll 等关键路径；
 * - 这里把外部兼容字符串统一归一成结构化 reason，核心逻辑只读字段；
 * - 这样外层文案或日志名变化时，不会静默改变虚拟化窗口策略。
 */

export type RenderVirtualizationRefreshReason =
  | { type: 'initial' }
  | { type: 'manual'; label: string }
  | { type: 'scheduled'; label: string }
  | { type: 'scroll'; source: 'native' | 'editor'; isJump?: boolean; isCorrection?: boolean }
  | { type: 'keyboard' }
  | { type: 'after-dispatch' }
  | { type: 'content-loaded'; source: 'file' | 'pending-revisions' }

export type RenderVirtualizationRefreshReasonInput =
  | RenderVirtualizationRefreshReason
  | string
  | undefined

export function normalizeRenderVirtualizationRefreshReason(
  input: RenderVirtualizationRefreshReasonInput
): RenderVirtualizationRefreshReason {
  if (!input) return { type: 'manual', label: 'manual' }
  if (typeof input !== 'string') return input

  switch (input) {
    case 'initial':
      return { type: 'initial' }
    case 'scroll':
      return { type: 'scroll', source: 'native' }
    case 'editor-scroll':
      return { type: 'scroll', source: 'editor' }
    case 'scroll-jump':
      return { type: 'scroll', source: 'native', isJump: true }
    case 'scroll-correction':
      return { type: 'scroll', source: 'native', isCorrection: true }
    case 'render-virtualization:keyboard':
      return { type: 'keyboard' }
    case 'render-virtualization:after-dispatch':
      return { type: 'after-dispatch' }
    case 'file-content-loaded':
      return { type: 'content-loaded', source: 'file' }
    case 'pending-revisions-loaded':
      return { type: 'content-loaded', source: 'pending-revisions' }
    case 'scheduled':
      return { type: 'scheduled', label: 'scheduled' }
    default:
      return { type: 'manual', label: input }
  }
}

export function formatRenderVirtualizationRefreshReason(
  reason: RenderVirtualizationRefreshReason
): string {
  switch (reason.type) {
    case 'initial':
      return 'initial'
    case 'manual':
      return reason.label
    case 'scheduled':
      return reason.label
    case 'scroll':
      if (reason.isJump) return 'scroll-jump'
      if (reason.isCorrection) return 'scroll-correction'
      return reason.source === 'editor' ? 'editor-scroll' : 'scroll'
    case 'keyboard':
      return 'render-virtualization:keyboard'
    case 'after-dispatch':
      return 'render-virtualization:after-dispatch'
    case 'content-loaded':
      return reason.source === 'file' ? 'file-content-loaded' : 'pending-revisions-loaded'
    default:
      return 'manual'
  }
}

export function mergeRenderVirtualizationRefreshReasons(
  reasons: Iterable<RenderVirtualizationRefreshReason>
): RenderVirtualizationRefreshReason {
  const collected = [...reasons]
  if (collected.length === 0) return { type: 'manual', label: 'manual' }

  const jump = collected.find(
    (reason) => reason.type === 'scroll' && reason.isJump
  )
  if (jump) return jump

  const correction = collected.find(
    (reason) => reason.type === 'scroll' && reason.isCorrection
  )
  if (correction) return correction

  const editorScroll = collected.find(
    (reason) => reason.type === 'scroll' && reason.source === 'editor'
  )
  if (editorScroll) return editorScroll

  const nativeScroll = collected.find((reason) => reason.type === 'scroll')
  if (nativeScroll) return nativeScroll

  const afterDispatch = collected.find((reason) => reason.type === 'after-dispatch')
  if (afterDispatch) return afterDispatch

  return collected[collected.length - 1] ?? { type: 'manual', label: 'manual' }
}

export function shouldPreferDomSamplingForReason(
  reason: RenderVirtualizationRefreshReason
): boolean {
  return (
    reason.type === 'scroll' &&
    (reason.isJump === true || reason.isCorrection === true || reason.source === 'editor')
  )
}
