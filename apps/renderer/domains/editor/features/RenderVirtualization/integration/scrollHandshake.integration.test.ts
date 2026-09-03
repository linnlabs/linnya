// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { getRootBlockRuntimeRegistry } from '../runtime/RootBlockRuntimeRegistry'
import {
  getRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import { dispatchRenderVirtualizationKeepAlive } from '../state/keepAliveEvents'
import {
  scrollEditorToBlock,
} from '../controller/scrollHandshake'
import {
  createVirtualizationIntegrationHarness,
} from './virtualizationIntegrationHarness'

describe('RenderVirtualization scrollHandshake integration gate', () => {
  it('does not resolve a pending handshake from another editor runtime registry with the same block id', async () => {
    vi.useFakeTimers()
    const first = createVirtualizationIntegrationHarness({
      blockCount: 30,
      blockIdPrefix: 'shared-block',
      maxWindowBlockCount: 3,
    })
    const second = createVirtualizationIntegrationHarness({
      blockCount: 30,
      blockIdPrefix: 'shared-block',
      maxWindowBlockCount: 3,
    })

    try {
      first.flushAllFrames()
      second.flushAllFrames()
      const firstHydratedBlockIds = new Set(first.engine.getSnapshot().hydratedBlockIds)
      const targetBlockId = Array.from({ length: 30 }, (_, index) => `shared-block-${index}`)
        .find((blockId) => !firstHydratedBlockIds.has(blockId))
      if (!targetBlockId) {
        throw new Error('测试夹具缺少离屏 rootBlock，无法覆盖跨 editor handshake 隔离')
      }

      let settled = false
      const handshake = scrollEditorToBlock(first.editor, targetBlockId, {
        select: 'none',
        timeoutMs: 1000,
        temporaryPinMs: 1000,
      }).finally(() => {
        settled = true
      })

      expect(getRootBlockRuntimeRegistry(first.editor).getDebugSnapshot().pendingHydratedWaiterCount).toBe(1)
      second.registerHydratedRuntimeHandle(targetBlockId)
      await Promise.resolve()

      // 中文说明：相同 blockId 在另一个 editor 里 hydrated，不能唤醒当前 editor 的 handshake。
      // 这是 scrollHandshake 从全局 registry 迁到 owner-scoped registry 后的核心防回归门禁。
      expect(settled).toBe(false)
      expect(getRootBlockRuntimeRegistry(first.editor).getDebugSnapshot().pendingHydratedWaiterCount).toBe(1)

      await vi.advanceTimersByTimeAsync(1000)
      await expect(handshake).resolves.toMatchObject({
        ok: false,
        reason: 'hydrate-timeout',
        blockId: targetBlockId,
      })
    } finally {
      first.cleanup()
      second.cleanup()
      vi.useRealTimers()
    }
  })

  it('keeps a stale handshake from a cleaned-up editor from mutating the next editor instance', async () => {
    vi.useFakeTimers()
    const first = createVirtualizationIntegrationHarness({
      blockCount: 30,
      blockIdPrefix: 'shared-block',
      maxWindowBlockCount: 3,
    })

    try {
      first.flushAllFrames()
      const firstHydratedBlockIds = new Set(first.engine.getSnapshot().hydratedBlockIds)
      const staleTargetBlockId = Array.from({ length: 30 }, (_, index) => `shared-block-${index}`)
        .find((blockId) => !firstHydratedBlockIds.has(blockId))
      if (!staleTargetBlockId) {
        throw new Error('测试夹具缺少离屏 rootBlock，无法覆盖 stale handshake waiter')
      }
      const staleHandshake = scrollEditorToBlock(first.editor, staleTargetBlockId, {
        select: 'none',
        timeoutMs: 1000,
        temporaryPinMs: 1000,
      })

      expect(getRenderVirtualizationState(first.getState())?.pinnedSet.has(staleTargetBlockId)).toBe(true)
      expect(getRootBlockRuntimeRegistry(first.editor).getDebugSnapshot().pendingHydratedWaiterCount).toBe(1)

      first.cleanup()
      await expect(staleHandshake).resolves.toMatchObject({
        ok: false,
        reason: 'hydrate-timeout',
        blockId: staleTargetBlockId,
      })

      const second = createVirtualizationIntegrationHarness({
        blockCount: 30,
        blockIdPrefix: 'shared-block',
        maxWindowBlockCount: 3,
      })

      try {
        second.flushAllFrames()
        second.syncRuntimeHandlesFromPluginState()
        const secondTarget = getRootBlockRuntimeRegistry(second.editor).getHydrated('shared-block-0')?.getDom()
        if (!secondTarget) {
          throw new Error('测试夹具缺少 second editor 的 hydrated runtime DOM')
        }
        dispatchRenderVirtualizationKeepAlive(secondTarget, {
          blockId: 'shared-block-0',
          reason: 'revision-toolbar',
          active: true,
        })

        await vi.runOnlyPendingTimersAsync()

        // 中文说明：旧 editor 的 handshake waiter / timer 即使迟到，也只能影响旧 owner。
        // 新 editor 使用相同 blockId 前缀时，runtime registry 与 pinnedSet 都不能被旧事件污染。
        expect(getRenderVirtualizationState(second.getState())?.pinnedSet.has('shared-block-0')).toBe(true)
        expect(getRenderVirtualizationState(second.getState())?.pinnedSet.has(staleTargetBlockId)).toBe(false)
        expect(getRootBlockRuntimeRegistry(second.editor).getDebugSnapshot().pendingHydratedWaiterCount).toBe(0)
      } finally {
        second.cleanup()
      }
    } finally {
      first.cleanup()
      vi.useRealTimers()
    }
  })
})
