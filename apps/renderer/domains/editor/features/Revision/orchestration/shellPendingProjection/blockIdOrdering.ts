export const PERF_BLOCK_ID_SAMPLE_LIMIT = 12

export function makeBlockIdsKey(blockIds: readonly string[]): string {
  return blockIds.join('\u0001')
}

export function uniqueBlockIds(blockIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const blockId of blockIds) {
    if (typeof blockId !== 'string' || blockId.length === 0 || seen.has(blockId)) continue
    seen.add(blockId)
    result.push(blockId)
  }

  return result
}

export function sampleBlockIds(blockIds: readonly string[]): string[] {
  return blockIds.slice(0, PERF_BLOCK_ID_SAMPLE_LIMIT)
}

export function orderHydratedBlockIdsByVisiblePriority(params: {
  visibleBlockIds: readonly string[]
  hydratedBlockIds: readonly string[]
}): string[] {
  const hydratedSet = new Set(params.hydratedBlockIds)
  const ordered: string[] = []
  const added = new Set<string>()

  for (const blockId of params.visibleBlockIds) {
    if (!hydratedSet.has(blockId) || added.has(blockId)) continue
    ordered.push(blockId)
    added.add(blockId)
  }

  for (const blockId of params.hydratedBlockIds) {
    if (added.has(blockId)) continue
    ordered.push(blockId)
    added.add(blockId)
  }

  return ordered
}
