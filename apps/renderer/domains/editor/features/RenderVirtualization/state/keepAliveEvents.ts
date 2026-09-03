/**
 * keepAliveEvents.ts
 *
 * RenderVirtualization 的 DOM 级保活事件协议。
 *
 * 中文说明：
 * - BlockChrome / Revision / History 等 UI 不直接拿 controller 或 registry；
 * - 它们只在自身 DOM 上派发“某个 blockId 因某个 reason 需要保活/释放”的声明；
 * - RenderVirtualizationEngine 统一监听并写入 KeepAliveRegistry。
 */

import type { RenderVirtualizationKeepAliveReason } from './keepAliveRegistry'

export const RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT = 'render-virtualization-keep-alive'

export interface RenderVirtualizationKeepAliveEventDetail {
  blockId: string
  reason: RenderVirtualizationKeepAliveReason
  active: boolean
}

export type RenderVirtualizationKeepAliveEvent = CustomEvent<RenderVirtualizationKeepAliveEventDetail>

export function dispatchRenderVirtualizationKeepAlive(
  target: EventTarget | null,
  detail: RenderVirtualizationKeepAliveEventDetail
): boolean {
  if (!target || !detail.blockId) return false

  target.dispatchEvent(new CustomEvent<RenderVirtualizationKeepAliveEventDetail>(
    RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT,
    {
      bubbles: true,
      detail,
    }
  ))
  return true
}
