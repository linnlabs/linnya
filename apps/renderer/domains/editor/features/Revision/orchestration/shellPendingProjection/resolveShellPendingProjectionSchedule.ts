import type { RenderVirtualizationRefreshReason } from '../../../RenderVirtualization'

export function shouldPreferFrameShellPendingProjection(
  reason: RenderVirtualizationRefreshReason | undefined
): boolean {
  if (!reason) return false
  return (
    reason.type === 'keyboard' ||
    (reason.type === 'scroll' && (reason.isCorrection === true || reason.isJump === true))
  )
}
