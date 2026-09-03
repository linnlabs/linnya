import type { CanonicalPendingSession } from '../../store/types'

export interface RevisionOverlayRootBlockSnapshot {
  blockId: string
  top: number
  left: number
  width: number
  height: number
  bottom: number
  isPlaceholder: boolean
  renderMode: string | null
}

export interface RevisionOverlayItem {
  blockId: string
  top: number
  left: number
  width: number
  height: number
  insertCount: number
  deleteCount: number
  createdAt?: number
  /** canonical-only pending 也要有块级状态，不能等行内 diff 投影完成后才出现。 */
  forceIndicatorVisible: boolean
  /** 当前块是否已经有详细统计；没有时展示“待处理”轻量态。 */
  hasDetailedStats: boolean
  showToolbar: boolean
}

export interface RevisionOverlayCanonicalReader {
  getCanonicalSession: (blockId: string) => CanonicalPendingSession | null
}
