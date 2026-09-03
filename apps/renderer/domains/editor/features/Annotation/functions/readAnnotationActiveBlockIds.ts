export interface AnnotationActiveBlockCandidate {
  blockId?: string | null
  state?: string | null
}

const ACTIVE_ANNOTATION_STATES = new Set(['creating', 'editing'])

/**
 * 从批注运行态中提取需要块级 chrome 的 rootBlock。
 *
 * 中文说明：confirmed/resolved 批注只表示块上有标记，不代表需要强制显示 chrome；
 * creating/editing 面板才是正在交互的状态，应该进入 Host 的 active source。
 */
export function readAnnotationActiveBlockIds(
  annotations: readonly AnnotationActiveBlockCandidate[]
): string[] {
  const blockIds: string[] = []
  const seen = new Set<string>()

  annotations.forEach((annotation) => {
    const blockId = annotation.blockId?.trim()
    if (!blockId || seen.has(blockId)) return
    if (!annotation.state || !ACTIVE_ANNOTATION_STATES.has(annotation.state)) return

    seen.add(blockId)
    blockIds.push(blockId)
  })

  return blockIds
}
