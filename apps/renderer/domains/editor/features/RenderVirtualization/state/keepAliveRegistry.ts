/**
 * keepAliveRegistry.ts
 *
 * RootBlock 渲染虚拟化的保活租约表。
 *
 * 中文说明：
 * - viewport 只决定“是否应该渲染”，但交互中的块必须强制 hydrated；
 * - 同一个 blockId 可能同时被 composition、pointer、focus、toolbar 等多个原因保活；
 * - 同一个 reason 也可能来自多个浮层或交互入口，所以这里记录的是“租约次数”；
 * - 只有最后一个租约释放时，才通知 controller unpin，避免不同功能互相误伤。
 */

export const RENDER_VIRTUALIZATION_KEEP_ALIVE_REASONS = [
  'selection',
  'composition',
  'pointer',
  'focus',
  'interaction-open',
  'dragging',
  'history-mode',
  'revision-toolbar',
  'annotation',
  'ai-writing',
  'scroll-handshake',
  'table-ai',
  'table-column-resize',
] as const

export type RenderVirtualizationKeepAliveReason =
  (typeof RENDER_VIRTUALIZATION_KEEP_ALIVE_REASONS)[number]

const keepAliveReasonSet: ReadonlySet<string> = new Set(RENDER_VIRTUALIZATION_KEEP_ALIVE_REASONS)

export function isRenderVirtualizationKeepAliveReason(
  value: unknown
): value is RenderVirtualizationKeepAliveReason {
  return typeof value === 'string' && keepAliveReasonSet.has(value)
}

export interface KeepAliveRegistryOptions {
  onAcquire?: (blockId: string) => void
  onRelease?: (blockId: string) => void
}

type ReasonLeaseCounts = Map<RenderVirtualizationKeepAliveReason, number>

export interface KeepAliveRegistryBlockSnapshot {
  blockId: string
  reasons: Array<{
    reason: RenderVirtualizationKeepAliveReason
    leaseCount: number
  }>
  leaseCount: number
}

export interface KeepAliveRegistryDebugSnapshot {
  pinnedBlockCount: number
  leaseCount: number
  blocks: KeepAliveRegistryBlockSnapshot[]
}

export class KeepAliveRegistry {
  private readonly reasonsByBlockId = new Map<string, ReasonLeaseCounts>()

  constructor(private readonly options: KeepAliveRegistryOptions = {}) {}

  /**
   * 中文说明：返回值只表示“这个 reason 是否首次出现”，不是租约是否登记成功。
   * 同 reason 重复 pin 会增加租约计数，但不需要重复通知 controller pin。
   */
  pin(blockId: string, reason: RenderVirtualizationKeepAliveReason): boolean {
    if (!blockId) return false

    const existingReasons = this.reasonsByBlockId.get(blockId)
    if (existingReasons) {
      const previousLeaseCount = existingReasons.get(reason) ?? 0
      existingReasons.set(reason, previousLeaseCount + 1)
      return previousLeaseCount === 0
    }

    this.reasonsByBlockId.set(blockId, new Map([[reason, 1]]))
    this.options.onAcquire?.(blockId)
    return true
  }

  unpin(blockId: string, reason: RenderVirtualizationKeepAliveReason): boolean {
    const reasons = this.reasonsByBlockId.get(blockId)
    const previousLeaseCount = reasons?.get(reason) ?? 0
    if (!reasons || previousLeaseCount <= 0) return false

    if (previousLeaseCount > 1) {
      reasons.set(reason, previousLeaseCount - 1)
      return true
    }

    reasons.delete(reason)

    if (reasons.size === 0) {
      this.reasonsByBlockId.delete(blockId)
      this.options.onRelease?.(blockId)
    }
    return true
  }

  unpinReason(reason: RenderVirtualizationKeepAliveReason): string[] {
    const releasedBlockIds: string[] = []

    for (const blockId of [...this.reasonsByBlockId.keys()]) {
      const reasons = this.reasonsByBlockId.get(blockId)
      if (!reasons?.has(reason)) continue

      reasons.delete(reason)
      releasedBlockIds.push(blockId)

      if (reasons.size === 0) {
        this.reasonsByBlockId.delete(blockId)
        this.options.onRelease?.(blockId)
      }
    }

    return releasedBlockIds
  }

  has(blockId: string): boolean {
    return this.reasonsByBlockId.has(blockId)
  }

  getReasons(blockId: string): ReadonlySet<RenderVirtualizationKeepAliveReason> {
    const reasons = this.reasonsByBlockId.get(blockId)
    return reasons ? new Set(reasons.keys()) : new Set()
  }

  getPinnedBlockIds(): string[] {
    return [...this.reasonsByBlockId.keys()]
  }

  getDebugSnapshot(): KeepAliveRegistryDebugSnapshot {
    const blocks: KeepAliveRegistryBlockSnapshot[] = []
    let totalLeaseCount = 0

    this.reasonsByBlockId.forEach((reasonCounts, blockId) => {
      const reasons = [...reasonCounts.entries()].map(([reason, leaseCount]) => ({
        reason,
        leaseCount,
      }))
      const blockLeaseCount = reasons.reduce((sum, item) => sum + item.leaseCount, 0)
      totalLeaseCount += blockLeaseCount
      blocks.push({
        blockId,
        reasons,
        leaseCount: blockLeaseCount,
      })
    })

    return {
      pinnedBlockCount: blocks.length,
      leaseCount: totalLeaseCount,
      blocks,
    }
  }

  clear(options: { notify?: boolean } = {}): void {
    const shouldNotify = options.notify !== false
    const blockIds = [...this.reasonsByBlockId.keys()]
    this.reasonsByBlockId.clear()
    for (const blockId of blockIds) {
      if (shouldNotify) this.options.onRelease?.(blockId)
    }
  }
}
