export interface RevisionToolbarBlockCandidate {
  blockId: string
  showToolbar: boolean
}

/**
 * 从 Revision overlay item 中提取正在显示块级修订工具栏的 rootBlock。
 *
 * 中文说明：Revision overlay 已经是“是否显示 toolbar”的规则归属地；
 * BlockChromeHost 只消费结果，避免复制 hover / selection / pending 组合规则。
 */
export function readRevisionToolbarBlockIds(
  items: readonly RevisionToolbarBlockCandidate[]
): string[] {
  const blockIds: string[] = []
  const seen = new Set<string>()

  items.forEach((item) => {
    const blockId = item.blockId.trim()
    if (!item.showToolbar || !blockId || seen.has(blockId)) return

    seen.add(blockId)
    blockIds.push(blockId)
  })

  return blockIds
}
