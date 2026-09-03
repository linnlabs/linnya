/**
 * useRenderVirtualizationKeepAliveLease.ts
 *
 * Vue 组件使用的 RootBlock 虚拟化保活租约。
 *
 * 中文说明：
 * - 组件只声明“我在某个 block 上有交互需要保活”；
 * - 释放动作由 onBeforeUnmount 自动兜底，避免业务组件漏 unpin；
 * - 非 Vue/NodeView 入口仍可走 keepAliveEvents，但推荐新代码使用本 hook。
 */

import { computed, inject, onBeforeUnmount, unref, watch, type Ref } from 'vue'
import type { RenderVirtualizationKeepAliveReason } from './keepAliveRegistry'
import {
  applyRenderVirtualizationKeepAliveCommand,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  type RenderVirtualizationKeepAlivePort,
} from './keepAlivePort'

type KeepAliveTargetInput =
  | EventTarget
  | null
  | undefined
  | Ref<EventTarget | null | undefined>
  | (() => EventTarget | null | undefined)

function isConnectedEventTarget(target: EventTarget | null): boolean {
  if (target === null) return false
  return target instanceof Node ? target.isConnected : true
}

function dispatchKeepAliveLease(params: {
  target: EventTarget | null
  port: RenderVirtualizationKeepAlivePort | null
  blockId: string
  reason: RenderVirtualizationKeepAliveReason
  active: boolean
}): boolean {
  return applyRenderVirtualizationKeepAliveCommand({
    port: params.port,
    legacyTarget: params.target,
    command: {
      blockId: params.blockId,
      reason: params.reason,
    },
    active: params.active,
  })
}

export function useRenderVirtualizationKeepAliveLease(params: {
  target: KeepAliveTargetInput
  /**
   * 中文说明：释放租约时原 target 可能已经被 Teleport 或虚拟化卸载移出 DOM。
   * 此时保活事件无法冒泡到 editor root，必须走稳定兜底目标完成 unpin。
   */
  fallbackTarget?: KeepAliveTargetInput
  blockId: Ref<string | null | undefined>
  reason: RenderVirtualizationKeepAliveReason
  active?: Ref<boolean>
}): void {
  let leasedBlockId: string | null = null
  let leasedTarget: EventTarget | null = null
  let leasedPort: RenderVirtualizationKeepAlivePort | null = null
  let warnedMissingTarget = false
  const injectedPort = inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null)
  const activeRef = params.active ?? computed(() => true)
  const targetRef = computed(resolveTarget)

  function resolveTarget(): EventTarget | null {
    return resolveTargetInput(params.target)
  }

  function resolveFallbackTarget(): EventTarget | null {
    return resolveTargetInput(params.fallbackTarget)
  }

  function resolveTargetInput(input: KeepAliveTargetInput): EventTarget | null {
    const target = typeof input === 'function'
      ? input()
      : unref(input)
    return target instanceof EventTarget ? target : null
  }

  function warnMissingTarget(): void {
    if (warnedMissingTarget || import.meta.env.PROD) return
    warnedMissingTarget = true
    console.warn('[RenderVirtualization] keepAlive lease target 不可用，已跳过本次租约', {
      reason: params.reason,
      blockId: params.blockId.value,
    })
  }

  function release(): void {
    if (!leasedBlockId) return
    const releaseTarget = isConnectedEventTarget(leasedTarget)
      ? leasedTarget
      : resolveFallbackTarget() ?? leasedTarget ?? resolveTarget()
    dispatchKeepAliveLease({
      target: releaseTarget,
      port: leasedPort,
      blockId: leasedBlockId,
      reason: params.reason,
      active: false,
    })
    leasedBlockId = null
    leasedTarget = null
    leasedPort = null
  }

  function acquire(blockId: string): void {
    const target = targetRef.value
    const port = injectedPort
    if (leasedBlockId === blockId && leasedTarget === target && leasedPort === port) return
    if (!port && !target) {
      release()
      warnMissingTarget()
      return
    }
    release()
    leasedBlockId = blockId
    leasedTarget = target
    leasedPort = port
    dispatchKeepAliveLease({
      target,
      port,
      blockId,
      reason: params.reason,
      active: true,
    })
  }

  watch(
    [params.blockId, activeRef, targetRef],
    ([blockId, active]) => {
      if (!active || !blockId) {
        release()
        return
      }
      acquire(blockId)
    },
    { immediate: true }
  )

  onBeforeUnmount(release)
}
