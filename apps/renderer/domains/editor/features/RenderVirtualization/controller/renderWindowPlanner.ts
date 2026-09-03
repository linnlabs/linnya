/**
 * renderWindowPlanner.ts
 *
 * RootBlock 虚拟化刷新时的窗口规划层。
 *
 * 中文说明：
 * - 本文件只把“文档块 + 高度缓存 + 视口事实 + 刷新原因”变成窗口计划；
 * - 不提交 transaction，也不读取 / 修改 PM plugin state；
 * - Engine 负责把这个计划交给 committer，并从 plugin state 读回最终事实。
 */

import type { EditorState } from 'prosemirror-state'
import {
  estimateRenderVirtualizationTotalLayoutHeight,
  getRenderVirtualizationBlockLayoutHeight,
} from '../state/blockHeightCacheRegistry'
import type { RenderVirtualizationRefreshReason } from './refreshReason'
import { shouldPreferDomSamplingForReason } from './refreshReason'
import {
  buildRootBlockMetrics,
  shouldPreferDomSampling,
  selectVisibleRenderWindow,
  type BuildRootBlockMetricsResult,
  type RootBlockMetric,
  type ViewportBounds,
  type WindowSelectionResult,
} from './renderWindowMath'
import { resolveRenderWindowBlockCount } from '../renderVirtualizationConstants'
import {
  collectDomSampledViewportBlockIds,
  readViewportAnchorBlockId,
  readViewportBounds,
} from './renderWindowDom'
import { collectRootBlockIds } from './renderWindowState'
import type { RenderVirtualizationOwner } from '../definitions/renderVirtualizationOwner'

export interface RenderWindowRefreshPlan {
  blockIds: readonly string[]
  viewport: ViewportBounds
  visibleWindow: WindowSelectionResult
  visibleBlockIds: readonly string[]
  totalEstimatedHeight: number
}

export function planRenderWindowRefresh(params: {
  editorState: EditorState
  editorRoot: HTMLElement
  scrollRoot: HTMLElement | null
  reason: RenderVirtualizationRefreshReason
  previousScrollTop: number
  overscanPx: number
  maxWindowBlockCount?: number
  currentHydratedBlockIds?: readonly string[]
  owner: RenderVirtualizationOwner
}): RenderWindowRefreshPlan {
  const blockIds = collectRootBlockIds(params.editorState)
  const viewport = readViewportBounds(params.editorRoot, params.scrollRoot)
  const estimatedTotalLayoutHeight = estimateRenderVirtualizationTotalLayoutHeight(
    blockIds.length,
    params.owner
  )
  const maxWindowBlockCount = resolveRenderWindowBlockCount({
    viewportHeight: Math.max(1, viewport.viewportBottom - viewport.viewportTop),
    overscanPx: params.overscanPx,
    totalEstimatedHeight: estimatedTotalLayoutHeight,
    blockCount: blockIds.length,
    configuredMaxWindowBlockCount: params.maxWindowBlockCount,
  })
  const preferDomSampling = shouldPreferDomSampling({
    reasonPrefersDomSampling: shouldPreferDomSamplingForReason(params.reason),
  })
  const sampledBlockIds = preferDomSampling
    ? collectDomSampledViewportBlockIds({
        editorRoot: params.editorRoot,
        scrollRoot: params.scrollRoot,
        maxItems: maxWindowBlockCount,
      })
    : []
  // 中文说明：超长文档不能依赖 height-cache 累计高度判断“当前视口是哪一段”。
  // 普通滚动使用单点 DOM anchor 作为窗口事实来源；跳转 / 纠偏路径如果多点 sample
  // 已经命中，则直接用 sample 中位数，不再额外读取单点 anchor。
  const anchorBlockId =
    sampledBlockIds.length === 0
      ? readViewportAnchorBlockId({
          editorRoot: params.editorRoot,
          scrollRoot: params.scrollRoot,
        })
      : null
  const allowStableWindowReuse =
    params.reason.type === 'scroll' &&
    params.reason.source === 'native' &&
    params.reason.isCorrection !== true &&
    params.reason.isJump !== true
  let metricsResult: BuildRootBlockMetricsResult | null = null
  let totalEstimatedHeight = estimatedTotalLayoutHeight
  const readMetricsResult = (): BuildRootBlockMetricsResult => {
    if (!metricsResult) {
      metricsResult = buildRootBlockMetrics(blockIds, blockId =>
        getRenderVirtualizationBlockLayoutHeight(blockId, params.owner)
      )
      totalEstimatedHeight = metricsResult.totalEstimatedHeight
    }
    return metricsResult
  }
  const getMetricsForHeightCache = (): readonly RootBlockMetric[] => {
    return readMetricsResult().metrics
  }
  const visibleWindow = selectVisibleRenderWindow({
    blockIds,
    viewportTop: viewport.viewportTop,
    viewportBottom: viewport.viewportBottom,
    overscanPx: params.overscanPx,
    maxWindowBlockCount,
    sampledBlockIds,
    anchorBlockId,
    currentWindowBlockIds: params.currentHydratedBlockIds,
    allowStableWindowReuse,
    preferDomSampling,
    getMetricsForHeightCache,
  })
  return {
    blockIds,
    viewport,
    visibleWindow,
    visibleBlockIds: visibleWindow.blockIds,
    totalEstimatedHeight,
  }
}
