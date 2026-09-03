/**
 * renderVirtualizationEngineDefaults.ts
 *
 * Engine 编排器的默认调度与空快照。
 *
 * 中文说明：这些是无状态基础设施，拆出来避免主 Engine 继续膨胀。
 */

import type { RenderVirtualizationEngineSnapshot } from './renderVirtualizationEngine'

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function defaultScheduleFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback)
  }
  return Number(globalThis.setTimeout(callback, 16))
}

export function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle)
    return
  }
  clearTimeout(handle)
}

export function createEmptyRenderVirtualizationSnapshot(): RenderVirtualizationEngineSnapshot {
  return {
    version: 0,
    reason: 'initial',
    refreshReason: { type: 'initial' },
    capturedAt: 0,
    virtualizationEnabled: false,
    visibleBlockIds: [],
    hydratedBlockIds: [],
    pinnedBlockIds: [],
    requestedHydrateBlockIds: [],
    requestedDehydrateBlockIds: [],
    scrollTop: 0,
    viewportTop: 0,
    viewportBottom: 0,
    totalEstimatedHeight: 0,
  }
}
