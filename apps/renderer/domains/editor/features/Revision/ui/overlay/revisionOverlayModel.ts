import type {
  RevisionOverlayCanonicalReader,
  RevisionOverlayItem,
  RevisionOverlayRootBlockSnapshot,
} from './revisionOverlayTypes'

export interface BuildRevisionOverlayItemsParams {
  blocks: readonly RevisionOverlayRootBlockSnapshot[]
  reader: RevisionOverlayCanonicalReader
  hoveredBlockId: string | null
  toolbarHoverBlockId: string | null
  selectionBlockId: string | null
}

function hasStats(session: ReturnType<RevisionOverlayCanonicalReader['getCanonicalSession']>): boolean {
  return typeof session?.diffStats?.insertCount === 'number' || typeof session?.diffStats?.deleteCount === 'number'
}

export function buildRevisionOverlayItems(
  params: BuildRevisionOverlayItemsParams
): RevisionOverlayItem[] {
  const result: RevisionOverlayItem[] = []

  for (const block of params.blocks) {
    const session = params.reader.getCanonicalSession(block.blockId)
    if (!session) continue

    const hasDetailedStats = hasStats(session)
    result.push({
      blockId: block.blockId,
      top: block.top,
      left: block.left,
      width: block.width,
      height: block.height,
      insertCount: session.diffStats?.insertCount ?? 0,
      deleteCount: session.diffStats?.deleteCount ?? 0,
      createdAt: session.createdAt,
      forceIndicatorVisible: true,
      hasDetailedStats,
      showToolbar:
        params.hoveredBlockId === block.blockId ||
        params.toolbarHoverBlockId === block.blockId ||
        params.selectionBlockId === block.blockId,
    })
  }

  return result
}
