/**
 * renderWindowMath.ts
 *
 * RootBlock 虚拟化窗口的纯计算层。
 *
 * 中文说明：
 * - 本文件不读取 DOM、不派发 ProseMirror transaction；
 * - 输入是 block 顺序、视口范围、高度缓存和可选 DOM 采样得到的 blockId；
 * - 输出是这次应该 hydrated 的窗口，以及窗口选择来源。
 */

export interface RootBlockMetric {
  blockId: string
  top: number
  bottom: number
  height: number
}

export interface ViewportBounds {
  scrollTop: number
  viewportTop: number
  viewportBottom: number
}

export interface WindowSelectionResult {
  blockIds: string[]
  anchorBlockId: string | null
  source: 'height-cache' | 'dom-anchor' | 'dom-anchor-reuse' | 'dom-anchor-shift' | 'dom-sample'
}

export interface BuildRootBlockMetricsResult {
  metrics: RootBlockMetric[]
  totalEstimatedHeight: number
}

export function buildRootBlockMetrics(
  blockIds: readonly string[],
  getLayoutHeight: (blockId: string) => number
): BuildRootBlockMetricsResult {
  const metrics: RootBlockMetric[] = []
  let cursor = 0
  for (const blockId of blockIds) {
    const height = getLayoutHeight(blockId)
    metrics.push({
      blockId,
      top: cursor,
      bottom: cursor + height,
      height,
    })
    cursor += height
  }
  return {
    metrics,
    totalEstimatedHeight: cursor,
  }
}

export function selectWindowBlockIds(params: {
  metrics: readonly RootBlockMetric[]
  viewportTop: number
  viewportBottom: number
  overscanPx: number
  maxWindowBlockCount: number
}): string[] {
  const minTop = Math.max(0, params.viewportTop - params.overscanPx)
  const maxBottom = params.viewportBottom + params.overscanPx
  const result: string[] = []

  for (const metric of params.metrics) {
    if (metric.bottom <= minTop) continue
    if (metric.top >= maxBottom) {
      if (result.length > 0) break
      continue
    }
    result.push(metric.blockId)
    if (result.length >= params.maxWindowBlockCount) break
  }

  return result
}

export function selectWindowAroundAnchor(params: {
  blockIds: readonly string[]
  anchorBlockId: string
  maxWindowBlockCount: number
}): string[] {
  const anchorIndex = params.blockIds.indexOf(params.anchorBlockId)
  if (anchorIndex < 0) return []

  const safeWindowCount = Math.max(1, params.maxWindowBlockCount)
  const beforeCount = Math.floor((safeWindowCount - 1) / 2)
  const start = Math.max(0, anchorIndex - beforeCount)
  const end = Math.min(params.blockIds.length, start + safeWindowCount)
  return params.blockIds.slice(Math.max(0, end - safeWindowCount), end)
}

function areWindowsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((blockId, index) => blockId === right[index])
}

function resolveWindowEdgeGuard(windowBlockCount: number): number {
  const safeWindowCount = Math.max(1, windowBlockCount)
  const preferredGuard = Math.max(6, Math.floor(safeWindowCount * 0.16))
  const maxUsefulGuard = Math.max(1, Math.floor((safeWindowCount - 1) / 2))
  return Math.min(preferredGuard, maxUsefulGuard)
}

export function selectStableWindowAroundAnchor(params: {
  blockIds: readonly string[]
  anchorBlockId: string
  currentWindowBlockIds: readonly string[]
  maxWindowBlockCount: number
}): WindowSelectionResult | null {
  const safeWindowCount = Math.max(1, params.maxWindowBlockCount)
  const anchorIndex = params.blockIds.indexOf(params.anchorBlockId)
  if (anchorIndex < 0) return null

  const currentIndices = params.currentWindowBlockIds
    .map((blockId) => params.blockIds.indexOf(blockId))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)
  if (currentIndices.length === 0) return null

  const firstIndex = currentIndices[0]
  const lastIndex = currentIndices[currentIndices.length - 1]
  const currentSpan = lastIndex - firstIndex + 1
  if (currentSpan <= 0 || currentSpan > safeWindowCount) return null

  // 中文说明：普通滚动不需要每次都把窗口围绕 anchor 重新居中。
  // 只要 anchor 还在当前 hydrated 窗口的安全区里，就复用旧窗口，避免 20+ 个块反复 hydrate/dehydrate。
  const edgeGuard = resolveWindowEdgeGuard(safeWindowCount)
  const hasEnoughHeadroomBefore = firstIndex === 0 || anchorIndex - firstIndex >= edgeGuard
  const hasEnoughHeadroomAfter =
    lastIndex === params.blockIds.length - 1 || lastIndex - anchorIndex >= edgeGuard
  if (hasEnoughHeadroomBefore && hasEnoughHeadroomAfter) {
    return {
      blockIds: params.blockIds.slice(firstIndex, lastIndex + 1),
      anchorBlockId: params.anchorBlockId,
      source: 'dom-anchor-reuse',
    }
  }

  // 中文说明：anchor 碰到安全边界后，只把窗口平移到刚好恢复安全余量。
  // 这比重新居中更适合连续滚动：每轮只替换本次滚动跨过的一小段，避免 50+ 个块的批量 mount/unmount 尖峰。
  let shiftedFirstIndex = firstIndex
  if (!hasEnoughHeadroomAfter) {
    const requiredForwardShift = anchorIndex - (lastIndex - edgeGuard)
    shiftedFirstIndex = firstIndex + Math.max(1, requiredForwardShift)
  } else if (!hasEnoughHeadroomBefore) {
    const requiredBackwardShift = (firstIndex + edgeGuard) - anchorIndex
    shiftedFirstIndex = firstIndex - Math.max(1, requiredBackwardShift)
  }

  const maxStartIndex = Math.max(0, params.blockIds.length - safeWindowCount)
  const startIndex = Math.min(maxStartIndex, Math.max(0, shiftedFirstIndex))
  const endIndex = Math.min(params.blockIds.length, startIndex + safeWindowCount)
  const shiftedBlockIds = params.blockIds.slice(Math.max(0, endIndex - safeWindowCount), endIndex)
  if (shiftedBlockIds.length === 0) return null

  return {
    blockIds: shiftedBlockIds,
    anchorBlockId: params.anchorBlockId,
    source: areWindowsEqual(shiftedBlockIds, params.currentWindowBlockIds)
      ? 'dom-anchor-reuse'
      : 'dom-anchor-shift',
  }
}

export function selectWindowAroundSampledBlocks(params: {
  blockIds: readonly string[]
  sampledBlockIds: readonly string[]
  maxWindowBlockCount: number
}): WindowSelectionResult | null {
  const sampledIndices = params.sampledBlockIds
    .map((blockId) => params.blockIds.indexOf(blockId))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)

  if (sampledIndices.length === 0) return null

  const firstIndex = sampledIndices[0]
  const lastIndex = sampledIndices[sampledIndices.length - 1]
  const sampledSpan = lastIndex - firstIndex + 1
  const safeWindowCount = Math.max(1, params.maxWindowBlockCount)

  if (sampledSpan >= safeWindowCount) {
    const medianIndex = sampledIndices[Math.floor(sampledIndices.length / 2)]
    const beforeCount = Math.floor(safeWindowCount / 2)
    const start = Math.max(0, medianIndex - beforeCount)
    const end = Math.min(params.blockIds.length, start + safeWindowCount)
    return {
      blockIds: params.blockIds.slice(Math.max(0, end - safeWindowCount), end),
      anchorBlockId: params.blockIds[medianIndex] ?? null,
      source: 'dom-sample',
    }
  }

  const remaining = safeWindowCount - sampledSpan
  const beforeCount = Math.floor(remaining / 2)
  let start = Math.max(0, firstIndex - beforeCount)
  let end = Math.min(params.blockIds.length, start + safeWindowCount)
  start = Math.max(0, end - safeWindowCount)

  const medianIndex = sampledIndices[Math.floor(sampledIndices.length / 2)]
  return {
    blockIds: params.blockIds.slice(start, end),
    anchorBlockId: params.blockIds[medianIndex] ?? null,
    source: 'dom-sample',
  }
}

export function selectVisibleRenderWindow(params: {
  blockIds: readonly string[]
  metrics?: readonly RootBlockMetric[]
  getMetricsForHeightCache?: () => readonly RootBlockMetric[]
  viewportTop: number
  viewportBottom: number
  overscanPx: number
  maxWindowBlockCount: number
  sampledBlockIds?: readonly string[]
  anchorBlockId?: string | null
  currentWindowBlockIds?: readonly string[]
  allowStableWindowReuse?: boolean
  preferDomSampling: boolean
}): WindowSelectionResult {
  if (params.preferDomSampling) {
    const sampledWindow = selectWindowAroundSampledBlocks({
      blockIds: params.blockIds,
      sampledBlockIds: params.sampledBlockIds ?? [],
      maxWindowBlockCount: params.maxWindowBlockCount,
    })
    if (sampledWindow) return sampledWindow
  }

  if (params.anchorBlockId) {
    if (params.allowStableWindowReuse) {
      const stableWindow = selectStableWindowAroundAnchor({
        blockIds: params.blockIds,
        anchorBlockId: params.anchorBlockId,
        currentWindowBlockIds: params.currentWindowBlockIds ?? [],
        maxWindowBlockCount: params.maxWindowBlockCount,
      })
      if (stableWindow) return stableWindow
    }

    const anchoredBlockIds = selectWindowAroundAnchor({
      blockIds: params.blockIds,
      anchorBlockId: params.anchorBlockId,
      maxWindowBlockCount: params.maxWindowBlockCount,
    })
    if (anchoredBlockIds.length > 0) {
      return {
        blockIds: anchoredBlockIds,
        anchorBlockId: params.anchorBlockId,
        source: 'dom-anchor',
      }
    }
  }

  const metrics = params.metrics ?? params.getMetricsForHeightCache?.() ?? []
  return {
    blockIds: selectWindowBlockIds({
      metrics,
      viewportTop: params.viewportTop,
      viewportBottom: params.viewportBottom,
      overscanPx: params.overscanPx,
      maxWindowBlockCount: params.maxWindowBlockCount,
    }),
    anchorBlockId: null,
    source: 'height-cache',
  }
}

export function shouldPreferDomSampling(params: {
  reasonPrefersDomSampling: boolean
}): boolean {
  // 中文说明：这里控制的是多点 DOM sample，不是单点 anchor。
  // 单点 anchor 是普通滚动的事实来源，用来避免超长文档里 height-cache 累计误差选错窗口；
  // 多点 sample 只给跳转 / 纠偏等需要更强覆盖的路径使用。
  return params.reasonPrefersDomSampling
}

export function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  const result: string[] = []
  left.forEach((value) => {
    if (!right.has(value)) result.push(value)
  })
  return result
}
